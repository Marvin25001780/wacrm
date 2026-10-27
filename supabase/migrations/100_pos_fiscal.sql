-- ============================================================
-- 100_pos_fiscal.sql — Facturación fiscal
--
-- * Configuración por negocio: RIF, dirección fiscal, actividad,
--   serie, máquina, rango autorizado y numeración.
-- * Emite una factura sobre una venta usando el siguiente número
--   del rango autorizado.
-- * No sustituye la impresora o proveedor fiscal certificado: usa
--   los datos del rango que el comercio tenga autorizado.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_fiscal_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  legal_name TEXT,
  tax_id TEXT,
  fiscal_address TEXT,
  economic_activity TEXT,
  printer_serial TEXT,
  machine_number TEXT,
  invoice_series TEXT,
  range_from BIGINT,
  range_to BIGINT,
  next_number BIGINT,
  control_prefix TEXT,
  control_next BIGINT,
  legend TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pos_fiscal_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_fiscal_settings_select ON pos_fiscal_settings;
DROP POLICY IF EXISTS pos_fiscal_settings_write ON pos_fiscal_settings;
CREATE POLICY pos_fiscal_settings_select ON pos_fiscal_settings
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_fiscal_settings_write ON pos_fiscal_settings
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS invoice_number BIGINT,
  ADD COLUMN IF NOT EXISTS control_number TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_serial TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_machine TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fiscal_status TEXT NOT NULL DEFAULT 'none'
    CHECK (fiscal_status IN ('none', 'fiscal', 'void')),
  ADD COLUMN IF NOT EXISTS customer_tax_id TEXT,
  ADD COLUMN IF NOT EXISTS customer_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_address TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_sales_fiscal_invoice
  ON pos_sales(account_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_sales_fiscal_status
  ON pos_sales(account_id, fiscal_status, fiscal_issued_at DESC);

CREATE OR REPLACE FUNCTION pos_issue_fiscal_invoice(
  p_sale_id UUID,
  p_customer_tax_id TEXT,
  p_customer_name TEXT,
  p_customer_address TEXT DEFAULT NULL
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
  v_settings RECORD;
  v_invoice BIGINT;
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
  IF COALESCE(v_settings.range_from, 0) <= 0
     OR COALESCE(v_settings.range_to, 0) < v_settings.range_from
     OR COALESCE(v_settings.next_number, 0) <= 0 THEN
    RAISE EXCEPTION 'Configura el rango autorizado antes de facturar';
  END IF;
  IF v_settings.next_number > v_settings.range_to THEN
    RAISE EXCEPTION 'El rango autorizado se agotó';
  END IF;
  IF COALESCE(p_customer_tax_id, '') = ''
     OR COALESCE(p_customer_name, '') = '' THEN
    RAISE EXCEPTION 'La factura necesita RIF y nombre del cliente';
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
  IF v_sale.fiscal_status = 'fiscal' THEN
    RAISE EXCEPTION 'La venta ya tiene factura fiscal';
  END IF;

  v_invoice := v_settings.next_number;
  v_control := COALESCE(v_settings.control_prefix, '') ||
    LPAD(COALESCE(v_settings.control_next, 1)::text, 8, '0');

  UPDATE pos_sales
     SET invoice_number = v_invoice,
         control_number = v_control,
         fiscal_serial = v_settings.printer_serial,
         fiscal_machine = v_settings.machine_number,
         fiscal_issued_at = NOW(),
         fiscal_status = 'fiscal',
         customer_tax_id = BTRIM(p_customer_tax_id),
         customer_legal_name = BTRIM(p_customer_name),
         customer_address = NULLIF(BTRIM(COALESCE(p_customer_address, '')), '')
   WHERE id = p_sale_id;

  UPDATE pos_fiscal_settings
     SET next_number = v_invoice + 1,
         control_next = COALESCE(control_next, 1) + 1,
         updated_at = NOW()
   WHERE account_id = v_account;

  RETURN jsonb_build_object(
    'sale_id', p_sale_id,
    'invoice_number', v_invoice,
    'control_number', v_control,
    'serial', v_settings.printer_serial,
    'machine', v_settings.machine_number,
    'customer_tax_id', BTRIM(p_customer_tax_id),
    'customer_name', BTRIM(p_customer_name)
  );
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pos_fiscal_settings
  TO authenticated;
GRANT EXECUTE ON FUNCTION pos_issue_fiscal_invoice(
  UUID, TEXT, TEXT, TEXT
) TO authenticated;

NOTIFY pgrst, 'reload schema';
