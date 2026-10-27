-- ============================================================
-- 090_pos_promos.sql — Descuentos y recargos
--
-- * pos_discounts: códigos que se aplican al cobrar.
-- * pos_surcharges: cargos adicionales (delivery, servicio...).
-- * pos_create_sale acepta el código de descuento y los recargos
--   elegidos; el servidor vuelve a validarlos y calcula el total.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Descuentos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL CHECK (code = UPPER(code)),
  kind TEXT NOT NULL DEFAULT 'percent'
    CHECK (kind IN ('percent', 'fixed')),
  value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  valid_from DATE,
  valid_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, code)
);

CREATE INDEX IF NOT EXISTS idx_pos_discounts_account
  ON pos_discounts(account_id, active);

ALTER TABLE pos_discounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_discounts_select ON pos_discounts;
DROP POLICY IF EXISTS pos_discounts_write ON pos_discounts;
CREATE POLICY pos_discounts_select ON pos_discounts
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_discounts_write ON pos_discounts
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 2. Recargos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_surcharges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fixed'
    CHECK (kind IN ('percent', 'fixed')),
  value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  charge_customer BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_surcharges_account
  ON pos_surcharges(account_id, active);

ALTER TABLE pos_surcharges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_surcharges_select ON pos_surcharges;
DROP POLICY IF EXISTS pos_surcharges_write ON pos_surcharges;
CREATE POLICY pos_surcharges_select ON pos_surcharges
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_surcharges_write ON pos_surcharges
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 3. La venta guarda el código y el recargo cobrado
-- ------------------------------------------------------------
ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS discount_code TEXT,
  ADD COLUMN IF NOT EXISTS surcharge_usd NUMERIC(14,2) NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 4. Motor de ventas con descuento por código y recargos
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS pos_create_sale(JSONB, JSONB, UUID, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION pos_create_sale(
  p_items JSONB,
  p_payments JSONB DEFAULT '[]'::jsonb,
  p_customer_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_rate NUMERIC DEFAULT 0,
  p_discount_code TEXT DEFAULT NULL,
  p_surcharges JSONB DEFAULT '[]'::jsonb
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
  v_surcharge_total NUMERIC := 0;
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
  v_pay_amount NUMERIC;
  v_pay_igtf NUMERIC;
  v_currency TEXT;
  v_method TEXT;
  v_pay_account UUID;
  v_status TEXT;
  v_code TEXT;
  v_code_row RECORD;
  v_charge JSONB;
  v_charge_row RECORD;
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

  -- Código de descuento: se valida, se cuenta el uso y se guarda.
  -- Los importes ya vienen repartidos por línea desde el POS.
  IF p_discount_code IS NOT NULL AND BTRIM(p_discount_code) <> '' THEN
    v_code := UPPER(BTRIM(p_discount_code));

    SELECT * INTO v_code_row
      FROM pos_discounts
     WHERE account_id = v_account AND code = v_code
     FOR UPDATE;

    IF v_code_row.id IS NULL THEN
      RAISE EXCEPTION 'El código de descuento no existe';
    END IF;
    IF NOT v_code_row.active THEN
      RAISE EXCEPTION 'El descuento % está inactivo', v_code;
    END IF;
    IF v_code_row.valid_from IS NOT NULL AND CURRENT_DATE < v_code_row.valid_from THEN
      RAISE EXCEPTION 'El descuento % todavía no está vigente', v_code;
    END IF;
    IF v_code_row.valid_to IS NOT NULL AND CURRENT_DATE > v_code_row.valid_to THEN
      RAISE EXCEPTION 'El descuento % venció', v_code;
    END IF;
    IF v_code_row.max_uses IS NOT NULL AND v_code_row.used_count >= v_code_row.max_uses THEN
      RAISE EXCEPTION 'El descuento % agotó sus usos', v_code;
    END IF;
    IF v_discount <= 0 THEN
      RAISE EXCEPTION 'El descuento % no se aplicó a ninguna línea', v_code;
    END IF;

    UPDATE pos_discounts
       SET used_count = used_count + 1
     WHERE id = v_code_row.id;
  END IF;

  -- Recargos elegidos: solo los activos y cobrables al cliente.
  IF p_surcharges IS NOT NULL THEN
    FOR v_charge IN SELECT * FROM jsonb_array_elements(p_surcharges)
    LOOP
      SELECT * INTO v_charge_row
        FROM pos_surcharges
       WHERE id = (v_charge #>> '{}')::uuid
         AND account_id = v_account
         AND active
         AND charge_customer;

      IF v_charge_row.id IS NULL THEN
        RAISE EXCEPTION 'Recargo no válido';
      END IF;

      v_surcharge_total := v_surcharge_total + CASE
        WHEN v_charge_row.kind = 'percent'
          THEN ROUND(v_subtotal * v_charge_row.value / 100, 2)
        ELSE v_charge_row.value
      END;
    END LOOP;
  END IF;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_method := COALESCE(v_pay->>'method', 'other');
    v_currency := COALESCE(v_pay->>'currency', 'USD');
    v_pay_usd := COALESCE((v_pay->>'amount_usd')::numeric, 0);
    v_pay_amount := COALESCE((v_pay->>'amount')::numeric, v_pay_usd);
    v_pay_account := NULLIF(v_pay->>'pos_account_id', '')::uuid;

    IF v_pay_usd <= 0 THEN
      RAISE EXCEPTION 'Pago inválido';
    END IF;

    v_pay_igtf := CASE WHEN v_currency = 'USD' AND v_igtf_on
      THEN ROUND(v_pay_usd * v_igtf_rate / 100, 2)
      ELSE 0 END;

    INSERT INTO pos_sale_payments (
      sale_id, account_id, method, currency, amount, amount_usd, rate,
      igtf_usd, reference, pos_account_id
    ) VALUES (
      v_sale, v_account, v_method, v_currency,
      v_pay_amount, v_pay_usd, v_rate, v_pay_igtf,
      v_pay->>'reference', v_pay_account
    );

    IF v_pay_account IS NOT NULL THEN
      INSERT INTO pos_transactions (
        account_id, pos_account_id, kind, category, description,
        amount, currency, amount_usd, rate, sale_id, created_by
      ) VALUES (
        v_account, v_pay_account, 'in', 'sale',
        'Venta #' || v_number,
        v_pay_amount + v_pay_igtf,
        v_currency,
        v_pay_usd + v_pay_igtf,
        v_rate, v_sale, v_user
      );
    END IF;

    v_paid := v_paid + v_pay_usd + v_pay_igtf;
    v_igtf_total := v_igtf_total + v_pay_igtf;
  END LOOP;

  v_total := ROUND(v_subtotal + v_iva_total + v_igtf_total + v_surcharge_total, 2);
  v_status := CASE WHEN v_paid + 0.005 >= v_total THEN 'paid' ELSE 'credit' END;

  UPDATE pos_sales
     SET subtotal_usd = ROUND(v_subtotal, 2),
         discount_usd = ROUND(v_discount, 2),
         discount_code = NULLIF(v_code, ''),
         surcharge_usd = ROUND(v_surcharge_total, 2),
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
    'surcharge_usd', ROUND(v_surcharge_total, 2),
    'tax_iva_usd', ROUND(v_iva_total, 2),
    'tax_igtf_usd', ROUND(v_igtf_total, 2),
    'total_usd', v_total,
    'paid_usd', ROUND(v_paid, 2),
    'balance_usd', GREATEST(ROUND(v_total - v_paid, 2), 0),
    'status', v_status
  );
END;
$$;

-- ------------------------------------------------------------
-- 5. Permisos
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.pos_discounts,
  public.pos_surcharges
TO authenticated;

GRANT EXECUTE ON FUNCTION pos_create_sale(
  JSONB, JSONB, UUID, TEXT, NUMERIC, TEXT, JSONB
) TO authenticated;

NOTIFY pgrst, 'reload schema';
