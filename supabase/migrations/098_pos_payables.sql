-- ============================================================
-- 098_pos_payables.sql — Compras a crédito y cuentas por pagar
--
-- * La compra puede quedar pagada o a crédito.
-- * Una compra pagada sale de una cuenta de Finanzas.
-- * Las compras a crédito se pagan después con pos_pay_supplier.
--
-- Idempotente.
-- ============================================================

ALTER TABLE pos_inventory_docs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'credit')),
  ADD COLUMN IF NOT EXISTS paid_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS supplier_name TEXT;

UPDATE pos_inventory_docs
   SET paid_usd = total_usd,
       balance_usd = 0
 WHERE kind = 'purchase'
   AND status = 'paid'
   AND paid_usd = 0
   AND total_usd > 0;

ALTER TABLE pos_transactions
  ADD COLUMN IF NOT EXISTS doc_id UUID
    REFERENCES pos_inventory_docs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_transactions_doc
  ON pos_transactions(doc_id);

CREATE TABLE IF NOT EXISTS pos_supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  doc_id UUID NOT NULL REFERENCES pos_inventory_docs(id) ON DELETE CASCADE,
  pos_account_id UUID REFERENCES pos_accounts(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'VES')),
  amount_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  rate NUMERIC(18,6) NOT NULL DEFAULT 0,
  reference TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_supplier_payments_doc
  ON pos_supplier_payments(doc_id, created_at DESC);

ALTER TABLE pos_supplier_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_supplier_payments_select ON pos_supplier_payments;
CREATE POLICY pos_supplier_payments_select ON pos_supplier_payments
  FOR SELECT USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION pos_create_purchase(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_user UUID := auth.uid();
  v_doc UUID;
  v_item JSONB;
  v_product RECORD;
  v_qty NUMERIC;
  v_cost NUMERIC;
  v_total NUMERIC := 0;
  v_new_stock NUMERIC;
  v_new_cost NUMERIC;
  v_credit BOOLEAN;
  v_acc RECORD;
  v_rate NUMERIC;
  v_native NUMERIC;
  v_description TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_user LIMIT 1;
  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_payload->'items' IS NULL OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'La compra no tiene líneas';
  END IF;

  v_credit := COALESCE(p_payload->>'payment_method', 'cash') = 'credit';

  IF NOT v_credit THEN
    IF NULLIF(p_payload->>'pos_account_id', '') IS NULL THEN
      RAISE EXCEPTION 'Selecciona la cuenta del pago';
    END IF;

    SELECT * INTO v_acc
      FROM pos_accounts
     WHERE id = (p_payload->>'pos_account_id')::uuid
       AND account_id = v_account
       AND active;

    IF v_acc.id IS NULL THEN
      RAISE EXCEPTION 'Cuenta de pago no válida';
    END IF;
  END IF;

  INSERT INTO pos_inventory_docs (
    account_id, kind, doc_date, supplier_id, supplier_name,
    payment_method, pos_account_id, invoice_number, note,
    status, due_date, created_by
  ) VALUES (
    v_account,
    'purchase',
    COALESCE((p_payload->>'doc_date')::date, CURRENT_DATE),
    NULLIF(p_payload->>'supplier_id', '')::uuid,
    NULLIF(p_payload->>'supplier_name', ''),
    p_payload->>'payment_method',
    CASE WHEN v_credit THEN NULL
         ELSE NULLIF(p_payload->>'pos_account_id', '')::uuid END,
    p_payload->>'invoice_number',
    p_payload->>'note',
    CASE WHEN v_credit THEN 'credit' ELSE 'paid' END,
    NULLIF(p_payload->>'due_date', '')::date,
    v_user
  ) RETURNING id INTO v_doc;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    v_cost := COALESCE((v_item->>'unit_cost_usd')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
    IF v_cost < 0 THEN RAISE EXCEPTION 'Costo inválido'; END IF;

    SELECT * INTO v_product
      FROM pos_products
     WHERE id = (v_item->>'product_id')::uuid
       AND account_id = v_account
       FOR UPDATE;

    IF v_product.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_product.kind = 'service' THEN
      RAISE EXCEPTION 'Un servicio no lleva inventario';
    END IF;

    v_new_stock := v_product.stock + v_qty;
    IF v_new_stock > 0 THEN
      v_new_cost := ROUND(
        ((v_product.stock * v_product.cost_usd) + (v_qty * v_cost)) / v_new_stock,
        2
      );
    ELSE
      v_new_cost := v_product.cost_usd;
    END IF;

    UPDATE pos_products
       SET stock = v_new_stock, cost_usd = v_new_cost, updated_at = NOW()
     WHERE id = v_product.id;

    INSERT INTO pos_inventory_doc_items (
      doc_id, account_id, product_id, quantity, unit_cost_usd, line_total_usd
    ) VALUES (
      v_doc, v_account, v_product.id, v_qty, v_cost, ROUND(v_qty * v_cost, 2)
    );

    INSERT INTO pos_inventory_movements (
      account_id, product_id, kind, quantity, unit_cost_usd, doc_id, created_by
    ) VALUES (
      v_account, v_product.id, 'purchase', v_qty, v_cost, v_doc, v_user
    );

    v_total := v_total + ROUND(v_qty * v_cost, 2);
  END LOOP;

  IF NOT v_credit THEN
    v_rate := COALESCE(
      NULLIF((p_payload->>'rate')::numeric, 0),
      0
    );
    IF v_rate <= 0 THEN
      SELECT rate INTO v_rate
        FROM exchange_rates
       WHERE account_id = v_account
       ORDER BY rate_date DESC, created_at DESC
       LIMIT 1;
    END IF;
    v_rate := COALESCE(v_rate, 0);

    IF v_acc.currency = 'VES' AND v_rate <= 0 THEN
      RAISE EXCEPTION 'Falta la tasa para pagar en bolívares';
    END IF;

    v_native := CASE
      WHEN v_acc.currency = 'VES' THEN ROUND(v_total * v_rate, 2)
      ELSE ROUND(v_total, 2)
    END;

    v_description := 'Compra';
    IF NULLIF(p_payload->>'invoice_number', '') IS NOT NULL THEN
      v_description := v_description || ' factura ' || (p_payload->>'invoice_number');
    END IF;
    IF NULLIF(p_payload->>'supplier_name', '') IS NOT NULL THEN
      v_description := v_description || ' · ' || (p_payload->>'supplier_name');
    END IF;

    INSERT INTO pos_transactions (
      account_id, pos_account_id, kind, category, description,
      amount, currency, amount_usd, rate, doc_id, created_by
    ) VALUES (
      v_account, v_acc.id, 'out', 'purchase', v_description,
      v_native, v_acc.currency, ROUND(v_total, 2), v_rate, v_doc, v_user
    );
  END IF;

  UPDATE pos_inventory_docs
     SET total_usd = v_total,
         paid_usd = CASE WHEN v_credit THEN 0 ELSE v_total END,
         balance_usd = CASE WHEN v_credit THEN v_total ELSE 0 END,
         status = CASE WHEN v_credit THEN 'credit' ELSE 'paid' END
   WHERE id = v_doc;

  RETURN jsonb_build_object(
    'doc_id', v_doc,
    'total_usd', v_total,
    'status', CASE WHEN v_credit THEN 'credit' ELSE 'paid' END,
    'balance_usd', CASE WHEN v_credit THEN v_total ELSE 0 END
  );
END;
$$;

CREATE OR REPLACE FUNCTION pos_pay_supplier(
  p_doc_id UUID,
  p_amount NUMERIC,
  p_account_id UUID,
  p_reference TEXT DEFAULT NULL,
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
  v_doc RECORD;
  v_acc RECORD;
  v_rate NUMERIC;
  v_native NUMERIC;
  v_new_balance NUMERIC;
  v_status TEXT;
  v_description TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_user LIMIT 1;
  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO v_doc
    FROM pos_inventory_docs
   WHERE id = p_doc_id AND account_id = v_account AND kind = 'purchase'
   FOR UPDATE;

  IF v_doc.id IS NULL THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF COALESCE(v_doc.balance_usd, 0) <= 0.005 THEN
    RAISE EXCEPTION 'La compra no tiene saldo pendiente';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'El pago debe ser mayor a cero';
  END IF;
  IF p_amount > v_doc.balance_usd + 0.005 THEN
    RAISE EXCEPTION 'El pago supera el saldo de la compra';
  END IF;

  SELECT * INTO v_acc
    FROM pos_accounts
   WHERE id = p_account_id AND account_id = v_account AND active;

  IF v_acc.id IS NULL THEN RAISE EXCEPTION 'Cuenta de pago no válida'; END IF;

  v_rate := COALESCE(NULLIF(p_rate, 0), 0);
  IF v_rate <= 0 THEN
    SELECT rate INTO v_rate
      FROM exchange_rates
     WHERE account_id = v_account
     ORDER BY rate_date DESC, created_at DESC
     LIMIT 1;
  END IF;
  v_rate := COALESCE(v_rate, 0);
  IF v_acc.currency = 'VES' AND v_rate <= 0 THEN
    RAISE EXCEPTION 'Falta la tasa para pagar en bolívares';
  END IF;

  v_native := CASE
    WHEN v_acc.currency = 'VES' THEN ROUND(p_amount * v_rate, 2)
    ELSE ROUND(p_amount, 2)
  END;

  v_description := 'Pago compra';
  IF v_doc.invoice_number IS NOT NULL THEN
    v_description := v_description || ' factura ' || v_doc.invoice_number;
  END IF;
  IF v_doc.supplier_name IS NOT NULL THEN
    v_description := v_description || ' · ' || v_doc.supplier_name;
  END IF;
  IF COALESCE(p_reference, '') <> '' THEN
    v_description := v_description || ' · Ref ' || p_reference;
  END IF;

  INSERT INTO pos_supplier_payments (
    account_id, doc_id, pos_account_id, amount, currency,
    amount_usd, rate, reference, created_by
  ) VALUES (
    v_account, p_doc_id, p_account_id, v_native, v_acc.currency,
    ROUND(p_amount, 2), v_rate, p_reference, v_user
  );

  INSERT INTO pos_transactions (
    account_id, pos_account_id, kind, category, description,
    amount, currency, amount_usd, rate, doc_id, created_by
  ) VALUES (
    v_account, p_account_id, 'out', 'purchase', v_description,
    v_native, v_acc.currency, ROUND(p_amount, 2), v_rate, p_doc_id, v_user
  );

  v_new_balance := GREATEST(ROUND(v_doc.balance_usd - p_amount, 2), 0);
  v_status := CASE WHEN v_new_balance <= 0.005 THEN 'paid' ELSE 'credit' END;

  UPDATE pos_inventory_docs
     SET paid_usd = ROUND(COALESCE(paid_usd, 0) + p_amount, 2),
         balance_usd = v_new_balance,
         status = v_status
   WHERE id = p_doc_id;

  RETURN jsonb_build_object(
    'doc_id', p_doc_id,
    'paid_usd', ROUND(p_amount, 2),
    'balance_usd', v_new_balance,
    'status', v_status
  );
END;
$$;

GRANT SELECT ON TABLE public.pos_supplier_payments TO authenticated;
GRANT EXECUTE ON FUNCTION pos_create_purchase(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_pay_supplier(
  UUID, NUMERIC, UUID, TEXT, NUMERIC
) TO authenticated;

NOTIFY pgrst, 'reload schema';
