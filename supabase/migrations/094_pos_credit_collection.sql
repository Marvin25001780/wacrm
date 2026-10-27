-- ============================================================
-- 094_pos_credit_collection.sql — Cobrar saldo de ventas a crédito
--
-- * Registra un abono sobre una venta con saldo pendiente.
-- * Entra el dinero a la cuenta elegida y se refleja en el turno.
-- * Actualiza pagado, saldo y estado de la venta.
--
-- Idempotente.
-- ============================================================

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
    'sale', 'purchase', 'expense', 'transfer', 'adjustment',
    'refund', 'collection', 'other'
  ));

CREATE OR REPLACE FUNCTION pos_collect_credit(
  p_sale_id UUID,
  p_amount NUMERIC,
  p_account_id UUID,
  p_method TEXT DEFAULT 'cash_usd',
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
  v_sale RECORD;
  v_acc RECORD;
  v_rate NUMERIC;
  v_native NUMERIC;
  v_new_balance NUMERIC;
  v_status TEXT;
  v_description TEXT;
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
  IF v_sale.status = 'paid' OR COALESCE(v_sale.balance_usd, 0) <= 0.005 THEN
    RAISE EXCEPTION 'La venta no tiene saldo pendiente';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'El abono debe ser mayor a cero';
  END IF;
  IF p_amount > COALESCE(v_sale.balance_usd, 0) + 0.005 THEN
    RAISE EXCEPTION 'El abono supera el saldo de la venta';
  END IF;

  SELECT * INTO v_acc
    FROM pos_accounts
   WHERE id = p_account_id
     AND account_id = v_account
     AND active;

  IF v_acc.id IS NULL THEN
    RAISE EXCEPTION 'Cuenta de cobro no válida';
  END IF;

  v_rate := COALESCE(
    NULLIF(p_rate, 0),
    NULLIF(v_sale.exchange_rate_used, 0),
    0
  );

  IF v_acc.currency = 'VES' AND v_rate <= 0 THEN
    RAISE EXCEPTION 'Falta la tasa para cobrar en bolívares';
  END IF;

  v_native := CASE
    WHEN v_acc.currency = 'VES' THEN ROUND(p_amount * v_rate, 2)
    ELSE ROUND(p_amount, 2)
  END;

  v_description := 'Abono venta #' || v_sale.number;
  IF COALESCE(p_method, '') <> '' THEN
    v_description := v_description || ' · ' || p_method;
  END IF;
  IF COALESCE(p_reference, '') <> '' THEN
    v_description := v_description || ' · Ref ' || p_reference;
  END IF;

  INSERT INTO pos_transactions (
    account_id, pos_account_id, kind, category, description,
    amount, currency, amount_usd, rate, sale_id, created_by
  ) VALUES (
    v_account, p_account_id, 'in', 'collection', v_description,
    v_native, v_acc.currency, ROUND(p_amount, 2), v_rate,
    p_sale_id, v_user
  );

  v_new_balance := GREATEST(ROUND(v_sale.balance_usd - p_amount, 2), 0);
  v_status := CASE WHEN v_new_balance <= 0.005 THEN 'paid' ELSE 'credit' END;

  UPDATE pos_sales
     SET paid_usd = ROUND(COALESCE(paid_usd, 0) + p_amount, 2),
         balance_usd = v_new_balance,
         status = v_status
   WHERE id = p_sale_id;

  RETURN jsonb_build_object(
    'sale_id', p_sale_id,
    'number', v_sale.number,
    'collected_usd', ROUND(p_amount, 2),
    'balance_usd', v_new_balance,
    'status', v_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION pos_collect_credit(
  UUID, NUMERIC, UUID, TEXT, TEXT, NUMERIC
) TO authenticated;

NOTIFY pgrst, 'reload schema';
