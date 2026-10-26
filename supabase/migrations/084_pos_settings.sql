-- ============================================================
-- 084_pos_settings.sql — Ajustes del POS
--
-- Identidad del comercio, datos del recibo, fuente de la tasa y
-- activación de impuestos. Todo por negocio.
--
-- Idempotente.
-- ============================================================

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS tax_id TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS receipt_title TEXT,
  ADD COLUMN IF NOT EXISTS receipt_footer TEXT,
  ADD COLUMN IF NOT EXISTS receipt_width TEXT NOT NULL DEFAULT '80'
    CHECK (receipt_width IN ('58', '80', 'letter')),
  ADD COLUMN IF NOT EXISTS receipt_fields JSONB NOT NULL DEFAULT
    '{"legal_name": true, "tax_id": true, "address": true, "phone": true, "customer": true, "sku": true, "total_bs": true, "rate": true, "notes": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS rate_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (rate_source IN ('bcv_usd', 'bcv_eur', 'manual')),
  ADD COLUMN IF NOT EXISTS iva_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS igtf_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS default_taxable BOOLEAN NOT NULL DEFAULT TRUE;

-- ------------------------------------------------------------
-- El motor de ventas respeta los interruptores de impuestos.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_create_sale(
  p_items JSONB,
  p_payments JSONB DEFAULT '[]'::jsonb,
  p_customer_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_rate NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_user UUID := auth.uid();
  v_iva NUMERIC := 16;
  v_igtf_rate NUMERIC := 3;
  v_iva_on BOOLEAN := TRUE;
  v_igtf_on BOOLEAN := TRUE;
  v_subtotal NUMERIC := 0;
  v_discount NUMERIC := 0;
  v_iva_total NUMERIC := 0;
  v_igtf_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_paid NUMERIC := 0;
  v_cost NUMERIC := 0;
  v_number INTEGER;
  v_sale UUID;
  v_item JSONB;
  v_pay JSONB;
  v_rate NUMERIC := p_rate;
  v_product RECORD;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_discount_line NUMERIC;
  v_line NUMERIC;
  v_pay_usd NUMERIC;
  v_pay_igtf NUMERIC;
  v_currency TEXT;
  v_method TEXT;
  v_status TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT account_id INTO v_account
    FROM profiles WHERE user_id = v_user LIMIT 1;

  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta no tiene productos';
  END IF;

  SELECT iva_rate, igtf_rate, iva_enabled, igtf_enabled
    INTO v_iva, v_igtf_rate, v_iva_on, v_igtf_on
    FROM pos_settings WHERE account_id = v_account;

  IF v_iva IS NULL THEN
    v_iva := 16;
    v_igtf_rate := 3;
    v_iva_on := TRUE;
    v_igtf_on := TRUE;
    INSERT INTO pos_settings (account_id) VALUES (v_account)
      ON CONFLICT (account_id) DO NOTHING;
  END IF;

  IF v_rate IS NULL OR v_rate <= 0 THEN
    SELECT rate INTO v_rate
      FROM exchange_rates
     WHERE account_id = v_account
     ORDER BY rate_date DESC, created_at DESC
     LIMIT 1;
  END IF;
  v_rate := COALESCE(v_rate, 0);

  PERFORM pg_advisory_xact_lock(hashtext('pos_sale:' || v_account::text));
  SELECT COALESCE(MAX(number), 0) + 1 INTO v_number
    FROM pos_sales WHERE account_id = v_account;

  INSERT INTO pos_sales (
    account_id, number, customer_id, user_id, status,
    exchange_rate_used, notes
  ) VALUES (
    v_account, v_number, p_customer_id, v_user, 'paid',
    v_rate, p_notes
  ) RETURNING id INTO v_sale;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product
      FROM pos_products
     WHERE id = (v_item->>'product_id')::uuid
       AND account_id = v_account;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_item->>'product_id';
    END IF;

    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para %', v_product.name;
    END IF;

    v_price := COALESCE((v_item->>'unit_price_usd')::numeric, v_product.price_usd);
    v_discount_line := COALESCE((v_item->>'discount_usd')::numeric, 0);
    v_line := ROUND(v_qty * v_price - v_discount_line, 2);

    IF v_line < 0 THEN
      RAISE EXCEPTION 'Descuento mayor que el precio en %', v_product.name;
    END IF;

    INSERT INTO pos_sale_items (
      sale_id, account_id, product_id, name, quantity,
      unit_cost_usd, unit_price_usd, discount_usd, taxable, line_total_usd
    ) VALUES (
      v_sale, v_account, v_product.id, v_product.name, v_qty,
      v_product.cost_usd, v_price, v_discount_line, v_product.taxable, v_line
    );

    v_subtotal := v_subtotal + v_line;
    v_discount := v_discount + v_discount_line;
    v_cost := v_cost + ROUND(v_qty * v_product.cost_usd, 2);

    IF v_product.taxable AND v_iva_on THEN
      v_iva_total := v_iva_total + ROUND(v_line * v_iva / 100, 2);
    END IF;

    IF v_product.kind = 'product' THEN
      IF v_product.stock < v_qty THEN
        RAISE EXCEPTION 'Stock insuficiente de % (disponible %)',
          v_product.name, v_product.stock;
      END IF;

      UPDATE pos_products
         SET stock = stock - v_qty,
             updated_at = NOW()
       WHERE id = v_product.id;

      INSERT INTO pos_inventory_movements (
        account_id, product_id, kind, quantity, unit_cost_usd, sale_id, created_by
      ) VALUES (
        v_account, v_product.id, 'sale', -v_qty, v_product.cost_usd, v_sale, v_user
      );
    END IF;
  END LOOP;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_method := COALESCE(v_pay->>'method', 'other');
    v_currency := COALESCE(v_pay->>'currency', 'USD');
    v_pay_usd := COALESCE((v_pay->>'amount_usd')::numeric, 0);

    IF v_pay_usd <= 0 THEN
      RAISE EXCEPTION 'Pago inválido';
    END IF;

    v_pay_igtf := CASE WHEN v_currency = 'USD' AND v_igtf_on
      THEN ROUND(v_pay_usd * v_igtf_rate / 100, 2)
      ELSE 0 END;

    INSERT INTO pos_sale_payments (
      sale_id, account_id, method, currency, amount, amount_usd, rate, igtf_usd, reference
    ) VALUES (
      v_sale, v_account, v_method, v_currency,
      COALESCE((v_pay->>'amount')::numeric, v_pay_usd),
      v_pay_usd, v_rate, v_pay_igtf, v_pay->>'reference'
    );

    v_paid := v_paid + v_pay_usd + v_pay_igtf;
    v_igtf_total := v_igtf_total + v_pay_igtf;
  END LOOP;

  v_total := ROUND(v_subtotal + v_iva_total + v_igtf_total, 2);
  v_status := CASE WHEN v_paid + 0.005 >= v_total THEN 'paid' ELSE 'credit' END;

  UPDATE pos_sales
     SET subtotal_usd = ROUND(v_subtotal, 2),
         discount_usd = ROUND(v_discount, 2),
         tax_iva_usd = ROUND(v_iva_total, 2),
         tax_igtf_usd = ROUND(v_igtf_total, 2),
         total_usd = v_total,
         paid_usd = ROUND(v_paid, 2),
         balance_usd = GREATEST(ROUND(v_total - v_paid, 2), 0),
         unit_cost_usd = ROUND(v_cost, 2),
         status = v_status
   WHERE id = v_sale;

  RETURN jsonb_build_object(
    'sale_id', v_sale,
    'number', v_number,
    'subtotal_usd', ROUND(v_subtotal, 2),
    'tax_iva_usd', ROUND(v_iva_total, 2),
    'tax_igtf_usd', ROUND(v_igtf_total, 2),
    'total_usd', v_total,
    'paid_usd', ROUND(v_paid, 2),
    'balance_usd', GREATEST(ROUND(v_total - v_paid, 2), 0),
    'status', v_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION pos_create_sale(JSONB, JSONB, UUID, TEXT, NUMERIC)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
