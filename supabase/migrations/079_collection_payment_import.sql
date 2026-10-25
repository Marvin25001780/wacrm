-- ============================================================
-- 079_collection_payment_import.sql - Importación masiva de pagos
--
-- Flujo:
--   1. La API parsea el archivo y crea un lote + filas crudas.
--   2. La API valida: ubica la cuota por folio + número, comprueba
--      saldo y duplicados, y guarda el resultado normalizado.
--   3. La API confirma: inserta los pagos reales. Los triggers de
--      073 recalculan cuota -> crédito -> deudor.
--
-- No se guarda ningún pago hasta el paso 3.
-- Idempotente - seguro de ejecutar varias veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS collection_payment_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('xlsx', 'csv')),
  file_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'mapping', 'validated', 'committed', 'failed', 'cancelled')),
  mapping JSONB,
  summary JSONB,
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_collection_payment_imports_account
  ON collection_payment_imports(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collection_payment_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES collection_payment_imports(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw JSONB NOT NULL,
  normalized JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'valid', 'warning', 'error', 'imported', 'skipped')),
  errors JSONB,
  installment_id UUID REFERENCES collection_installments(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES collection_payments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_payment_import_rows_batch
  ON collection_payment_import_rows(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_collection_payment_import_rows_account
  ON collection_payment_import_rows(account_id);

ALTER TABLE collection_payment_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_payment_imports_select ON collection_payment_imports;
DROP POLICY IF EXISTS collection_payment_imports_insert ON collection_payment_imports;
DROP POLICY IF EXISTS collection_payment_imports_update ON collection_payment_imports;
DROP POLICY IF EXISTS collection_payment_imports_delete ON collection_payment_imports;

CREATE POLICY collection_payment_imports_select ON collection_payment_imports
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_payment_imports_insert ON collection_payment_imports
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_payment_imports_update ON collection_payment_imports
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_payment_imports_delete ON collection_payment_imports
  FOR DELETE USING (is_account_member(account_id, 'admin'));

ALTER TABLE collection_payment_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_payment_import_rows_select ON collection_payment_import_rows;
DROP POLICY IF EXISTS collection_payment_import_rows_insert ON collection_payment_import_rows;
DROP POLICY IF EXISTS collection_payment_import_rows_update ON collection_payment_import_rows;
DROP POLICY IF EXISTS collection_payment_import_rows_delete ON collection_payment_import_rows;

CREATE POLICY collection_payment_import_rows_select ON collection_payment_import_rows
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_payment_import_rows_insert ON collection_payment_import_rows
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_payment_import_rows_update ON collection_payment_import_rows
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_payment_import_rows_delete ON collection_payment_import_rows
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS audit_collection_payment_imports ON collection_payment_imports;
CREATE TRIGGER audit_collection_payment_imports
  AFTER INSERT OR UPDATE OR DELETE ON collection_payment_imports
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE, DELETE ON collection_payment_imports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_payment_import_rows TO authenticated;
GRANT ALL ON collection_payment_imports TO service_role;
GRANT ALL ON collection_payment_import_rows TO service_role;

NOTIFY pgrst, 'reload schema';
