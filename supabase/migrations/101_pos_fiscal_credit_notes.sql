-- ============================================================
-- 101_pos_fiscal_credit_notes.sql — Notas de crédito fiscales
--
-- * Rango propio de notas de crédito en pos_fiscal_settings.
-- * Emite una nota de crédito sobre una devolución de una venta
--   que ya tiene factura fiscal.
-- * Cada devolución puede tener una sola nota de crédito.
--
-- Idempotente.
-- ============================================================

ALTER TABLE pos_fiscal_settings
  ADD COLUMN IF NOT EXISTS credit_series TEXT,
  ADD COLUMN IF NOT EXISTS credit_range_from BIGINT,
  ADD COLUMN IF NOT EXISTS credit_range_to BIGINT,
  ADD COLUMN IF NOT EXISTS credit_next_number BIGINT,
  ADD COLUMN IF NOT EXISTS credit_control_prefix TEXT,
  ADD COLUMN IF NOT EXISTS credit_control_next BIGINT;

CREATE TABLE IF NOT EXISTS pos_fiscal_credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES pos_sale_returns(id) ON DELETE CASCADE,
  number BIGINT NOT NULL,
  control_number TEXT,
  series TEXT,
  serial TEXT,
  machine TEXT,
  reason TEXT NOT NULL,
  subtotal_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_iva_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  customer_tax_id TEXT,
  customer_legal_name TEXT,
  customer_address TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (account_id, number),
  UNIQUE (return_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_fiscal_credit_notes_sale
  ON pos_fiscal_credit_notes(sale_id);

CREATE INDEX IF NOT EXISTS idx_pos_fiscal_credit_notes_account
  ON pos_fiscal_credit_notes(account_id, issued_at DESC);

ALTER TABLE pos_fiscal_credit_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_fiscal_credit_notes_select ON pos_fiscal_credit_notes;
CREATE POLICY pos_fiscal_credit_notes_select ON pos_fiscal_credit_notes
  FOR SELECT USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION pos_issue_fiscal_credit_note(p_return_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_account UUID;
  v_settings RECORD;
  v_return RECORD;
  v_number BIGINT;
  v_control TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT account_id INTO v_account
    FROM profiles WHERE user_id = v_user LIMIT 1;

  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO v_settings
    FROM pos_fiscal_settings
   WHERE account_id = v_account
   FOR UPDATE;

  IF v_settings.account_id IS NULL OR NOT v_settings.enabled THEN
    RAISE EXCEPTION 'La facturación fiscal no está activada';
  END IF;
  IF COALESCE(v_settings.credit_range_from, 0) <= 0
     OR COALESCE(v_settings.credit_range_to, 0) < v_settings.credit_range_from
     OR COALESCE(v_settings.credit_next_number, 0) <= 0 THEN
    RAISE EXCEPTION 'Configura el rango de notas de crédito';
  END IF;
  IF v_settings.credit_next_number > v_settings.credit_range_to THEN
    RAISE EXCEPTION 'El rango de notas de crédito se agotó';
  END IF;

  SELECT r.*, s.number AS sale_number, s.fiscal_status AS sale_fiscal_status,
         s.invoice_number AS sale_invoice_number,
         s.customer_tax_id AS sale_tax_id,
         s.customer_legal_name AS sale_legal_name,
         s.customer_address AS sale_address
    INTO v_return
    FROM pos_sale_returns r
    JOIN pos_sales s ON s.id = r.sale_id
   WHERE r.id = p_return_id
     AND r.account_id = v_account
   FOR UPDATE OF r;

  IF v_return.id IS NULL THEN
    RAISE EXCEPTION 'Devolución no encontrada';
  END IF;
  IF v_return.sale_fiscal_status <> 'fiscal' THEN
    RAISE EXCEPTION 'La venta no tiene factura fiscal';
  END IF;
  IF COALESCE(v_return.total_usd, 0) <= 0 THEN
    RAISE EXCEPTION 'La devolución no tiene valor';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pos_fiscal_credit_notes WHERE return_id = p_return_id
  ) THEN
    RAISE EXCEPTION 'La devolución ya tiene nota de crédito';
  END IF;

  v_number := v_settings.credit_next_number;
  v_control := COALESCE(v_settings.credit_control_prefix, '') ||
    LPAD(COALESCE(v_settings.credit_control_next, 1)::text, 8, '0');

  INSERT INTO pos_fiscal_credit_notes (
    account_id, sale_id, return_id, number, control_number, series,
    serial, machine, reason, subtotal_usd, tax_iva_usd, total_usd,
    customer_tax_id, customer_legal_name, customer_address, created_by
  ) VALUES (
    v_account, v_return.sale_id, p_return_id, v_number, v_control,
    v_settings.credit_series, v_settings.printer_serial,
    v_settings.machine_number, v_return.reason,
    COALESCE(v_return.subtotal_usd, 0),
    COALESCE(v_return.tax_iva_usd, 0),
    COALESCE(v_return.total_usd, 0),
    v_return.sale_tax_id, v_return.sale_legal_name, v_return.sale_address,
    v_user
  );

  UPDATE pos_fiscal_settings
     SET credit_next_number = v_number + 1,
         credit_control_next = COALESCE(credit_control_next, 1) + 1,
         updated_at = NOW()
   WHERE account_id = v_account;

  RETURN jsonb_build_object(
    'credit_note_id', (SELECT id FROM pos_fiscal_credit_notes WHERE return_id = p_return_id),
    'number', v_number,
    'control_number', v_control,
    'return_number', v_return.number,
    'sale_number', v_return.sale_number,
    'invoice_number', v_return.sale_invoice_number,
    'series', v_settings.credit_series,
    'serial', v_settings.printer_serial,
    'machine', v_settings.machine_number,
    'customer_tax_id', v_return.sale_tax_id,
    'customer_legal_name', v_return.sale_legal_name,
    'customer_address', v_return.sale_address,
    'reason', v_return.reason,
    'subtotal_usd', COALESCE(v_return.subtotal_usd, 0),
    'tax_iva_usd', COALESCE(v_return.tax_iva_usd, 0),
    'total_usd', COALESCE(v_return.total_usd, 0),
    'issued_at', NOW()
  );
END;
$$;

GRANT SELECT ON TABLE public.pos_fiscal_credit_notes TO authenticated;
GRANT EXECUTE ON FUNCTION pos_issue_fiscal_credit_note(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
