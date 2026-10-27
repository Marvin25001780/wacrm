-- ============================================================
-- 093_pos_sale_returns.sql — Devoluciones de venta
--
-- * Devuelve total o parcialmente una venta.
-- * Repone inventario y deja el movimiento de entrada.
-- * Puede devolver el dinero desde una cuenta o dejar nota de crédito.
-- * Guarda la devolución ligada a la venta y al turno abierto.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Devoluciones
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_sale_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  reason TEXT NOT NULL,
  subtotal_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_iva_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  refund_account_id UUID REFERENCES pos_accounts(id) ON DELETE SET NULL,
  shift_id UUID REFERENCES pos_shifts(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, number)
);

CREATE INDEX IF NOT EXISTS idx_pos_sale_returns_sale
  ON pos_sale_returns(sale_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_sale_returns_account
  ON pos_sale_returns(account_id, created_at DESC);

ALTER TABLE pos_sale_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_sale_returns_select ON pos_sale_returns;
CREATE POLICY pos_sale_returns_select ON pos_sale_returns
  FOR SELECT USING (is_account_member(account_id));

CREATE TABLE IF NOT EXISTS pos_sale_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES pos_sale_returns(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sale_item_id UUID NOT NULL REFERENCES pos_sale_items(id) ON DELETE CASCADE,
  product_id UUID REFERENCES pos_products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_cost_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_iva_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_usd NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pos_sale_return_items_return
  ON pos_sale_return_items(return_id);

CREATE INDEX IF NOT EXISTS idx_pos_sale_return_items_sale_item
  ON pos_sale_return_items(sale_item_id);

ALTER TABLE pos_sale_return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_sale_return_items_select ON pos_sale_return_items;
CREATE POLICY pos_sale_return_items_select ON pos_sale_return_items
  FOR SELECT USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- 2. La venta acumula lo devuelto
-- ------------------------------------------------------------
ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS returned_usd NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Las devoluciones salen de una cuenta y necesitan su categoría.
DO $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT conname INTO v_name
    FROM pg_constraint
   WHERE conrelid = 'pos_transactions'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%category%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE pos_transactions DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE pos_transactions
  DROP CONSTRAINT IF EXISTS pos_transactions_category_check;
ALTER TABLE pos_transactions
  ADD CONSTRAINT pos_transactions_category_check
  CHECK (category IN (
    'sale', 'purchase', 'expense', 'transfer', 'adjustment', 'refund', 'other'
  ));

-- ------------------------------------------------------------
-- 3. Crear devolución
-- p_items: [{ sale_item_id, quantity }]
-- p_refund_account_id NULL = nota de crédito (no sale dinero).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_create_sale_return(
  p_sale_id UUID,
  p_items JSONB,
  p_reason TEXT,
  p_refund_account_id UUID DEFAULT NULL,
  p_rate NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_account UUID;
  v_sale RECORD;
  v_item JSONB;
  v_sale_item RECORD;
  v_product RECORD;
  v_return UUID;
  v_number INTEGER;
  v_qty NUMERIC;
  v_returned NUMERIC;
  v_unit NUMERIC;
  v_net NUMERIC;
  v_tax NUMERIC;
  v_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_grand_total NUMERIC := 0;
  v_cost_total NUMERIC := 0;
  v_iva_rate NUMERIC := 16;
  v_iva_on BOOLEAN := TRUE;
  v_account_row RECORD;
  v_balance NUMERIC;
  v_rate NUMERIC;
  v_amount NUMERIC;
  v_shift UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT account_id INTO v_account
    FROM profiles WHERE user_id = v_user LIMIT 1;

  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO v_sale
    FROM pos_sales
   WHERE id = p_sale_id AND account_id = v_account
   FOR UPDATE;

  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;
  IF v_sale.status = 'void' THEN
    RAISE EXCEPTION 'La venta está anulada';
  END IF;
  IF COALESCE(p_reason, '') = '' THEN
    RAISE EXCEPTION 'Escribe el motivo de la devolución';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La devolución no tiene líneas';
  END IF;
  IF COALESCE(v_sale.balance_usd, 0) > 0.005 AND p_refund_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'La venta tiene saldo pendiente: registra la devolución como nota de crédito';
  END IF;

  SELECT iva_rate, iva_enabled INTO v_iva_rate, v_iva_on
    FROM pos_settings WHERE account_id = v_account;
  v_iva_rate := COALESCE(v_iva_rate, 16);
  v_iva_on := COALESCE(v_iva_on, TRUE);

  PERFORM pg_advisory_xact_lock(hashtext('pos_return:' || v_account::text));
  SELECT COALESCE(MAX(number), 0) + 1 INTO v_number
    FROM pos_sale_returns WHERE account_id = v_account;

  SELECT id INTO v_shift
    FROM pos_shifts
   WHERE account_id = v_account AND status = 'open'
   LIMIT 1;

  INSERT INTO pos_sale_returns (
    account_id, sale_id, number, reason, refund_account_id, shift_id, created_by
  ) VALUES (
    v_account, p_sale_id, v_number, p_reason,
    p_refund_account_id, v_shift, v_user
  ) RETURNING id INTO v_return;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_sale_item
      FROM pos_sale_items
     WHERE id = (v_item->>'sale_item_id')::uuid
       AND sale_id = p_sale_id
     FOR UPDATE;

    IF v_sale_item.id IS NULL THEN
      RAISE EXCEPTION 'Línea de venta no encontrada';
    END IF;

    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida en %', v_sale_item.name;
    END IF;

    SELECT COALESCE(SUM(ri.quantity), 0)
      INTO v_returned
      FROM pos_sale_return_items ri
      JOIN pos_sale_returns r ON r.id = ri.return_id
     WHERE ri.sale_item_id = v_sale_item.id
       AND r.sale_id = p_sale_id;

    IF v_returned + v_qty > v_sale_item.quantity THEN
      RAISE EXCEPTION 'Ya se devolvió toda la cantidad de %', v_sale_item.name;
    END IF;

    v_unit := ROUND(v_sale_item.line_total_usd / v_sale_item.quantity, 2);
    v_net := ROUND(
      v_sale_item.line_total_usd * (v_qty / v_sale_item.quantity),
      2
    );
    v_tax := CASE
      WHEN v_sale_item.taxable AND v_iva_on
        THEN ROUND(v_net * v_iva_rate / 100, 2)
      ELSE 0
    END;
    v_total := ROUND(v_net + v_tax, 2);

    INSERT INTO pos_sale_return_items (
      return_id, account_id, sale_item_id, product_id, name, quantity,
      unit_price_usd, unit_cost_usd, tax_iva_usd, total_usd
    ) VALUES (
      v_return, v_account, v_sale_item.id, v_sale_item.product_id,
      v_sale_item.name, v_qty, v_unit, v_sale_item.unit_cost_usd,
      v_tax, v_total
    );

    v_subtotal := v_subtotal + v_net;
    v_tax_total := v_tax_total + v_tax;
    v_grand_total := v_grand_total + v_total;
    v_cost_total := v_cost_total + ROUND(v_sale_item.unit_cost_usd * v_qty, 2);

    -- Reponer inventario solo si el producto sigue existiendo.
    IF v_sale_item.product_id IS NOT NULL THEN
      SELECT * INTO v_product
        FROM pos_products
       WHERE id = v_sale_item.product_id
       FOR UPDATE;

      IF v_product.id IS NOT NULL AND v_product.kind = 'product' THEN
        UPDATE pos_products
           SET stock = stock + v_qty,
               updated_at = NOW()
         WHERE id = v_product.id;

        INSERT INTO pos_inventory_movements (
          account_id, product_id, kind, quantity, unit_cost_usd,
          note, sale_id, created_by
        ) VALUES (
          v_account, v_product.id, 'return', v_qty,
          v_sale_item.unit_cost_usd,
          'Devolución venta #' || v_sale.number,
          p_sale_id, v_user
        );
      END IF;
    END IF;
  END LOOP;

  IF v_grand_total <= 0 THEN
    RAISE EXCEPTION 'La devolución no tiene valor';
  END IF;

  IF COALESCE(v_sale.balance_usd, 0) > 0.005
     AND v_grand_total > COALESCE(v_sale.balance_usd, 0) + 0.005 THEN
    RAISE EXCEPTION 'La devolución supera el saldo pendiente de la venta';
  END IF;

  -- Salida de dinero de la cuenta elegida.
  IF p_refund_account_id IS NOT NULL THEN
    SELECT * INTO v_account_row
      FROM pos_accounts
     WHERE id = p_refund_account_id
       AND account_id = v_account
       AND active;

    IF v_account_row.id IS NULL THEN
      RAISE EXCEPTION 'Cuenta de devolución no válida';
    END IF;

    v_balance := pos_account_balance(p_refund_account_id);
    IF v_balance < v_grand_total THEN
      RAISE EXCEPTION 'Saldo insuficiente en % para devolver %',
        v_account_row.name, v_grand_total;
    END IF;

    v_rate := COALESCE(NULLIF(p_rate, 0), NULLIF(v_sale.exchange_rate_used, 0), 0);
    IF v_account_row.currency = 'VES' AND v_rate <= 0 THEN
      RAISE EXCEPTION 'Falta la tasa para devolver en bolívares';
    END IF;
    v_amount := CASE
      WHEN v_account_row.currency = 'VES'
        THEN ROUND(v_grand_total * v_rate, 2)
      ELSE v_grand_total
    END;

    INSERT INTO pos_transactions (
      account_id, pos_account_id, kind, category, description,
      amount, currency, amount_usd, rate, sale_id, created_by
    ) VALUES (
      v_account, p_refund_account_id, 'out', 'refund',
      'Devolución venta #' || v_sale.number,
      v_amount, v_account_row.currency, v_grand_total,
      v_rate, p_sale_id, v_user
    );
  END IF;

  UPDATE pos_sales
     SET returned_usd = ROUND(COALESCE(returned_usd, 0) + v_grand_total, 2),
         balance_usd = CASE
           WHEN p_refund_account_id IS NULL
             THEN GREATEST(ROUND(COALESCE(balance_usd, 0) - v_grand_total, 2), 0)
           ELSE balance_usd
         END
   WHERE id = p_sale_id;

  UPDATE pos_sale_returns
     SET subtotal_usd = ROUND(v_subtotal, 2),
         tax_iva_usd = ROUND(v_tax_total, 2),
         total_usd = ROUND(v_grand_total, 2),
         cost_usd = ROUND(v_cost_total, 2)
   WHERE id = v_return;

  RETURN jsonb_build_object(
    'return_id', v_return,
    'number', v_number,
    'subtotal_usd', ROUND(v_subtotal, 2),
    'tax_iva_usd', ROUND(v_tax_total, 2),
    'total_usd', ROUND(v_grand_total, 2),
    'refunded', p_refund_account_id IS NOT NULL
  );
END;
$$;

-- ------------------------------------------------------------
-- 4. Permisos
-- ------------------------------------------------------------
GRANT SELECT ON TABLE
  public.pos_sale_returns,
  public.pos_sale_return_items
TO authenticated;

GRANT EXECUTE ON FUNCTION pos_create_sale_return(
  UUID, JSONB, TEXT, UUID, NUMERIC
) TO authenticated;

NOTIFY pgrst, 'reload schema';
