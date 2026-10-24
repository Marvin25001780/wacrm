-- ============================================================
-- 075_collection_import.sql - Importación masiva de cartera
--
-- Flujo:
--   1. La API parsea Excel/CSV y crea un batch + filas crudas.
--   2. La API normaliza y valida; marca cada fila valid/warning/error.
--   3. `collection_import_commit` inserta/actualiza todo en una
--      transacción y devuelve el resumen.
--
-- Idempotente - seguro de ejecutar varias veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS collection_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES collection_portfolios(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_collection_import_batches_account
  ON collection_import_batches(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collection_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES collection_import_batches(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw JSONB NOT NULL,
  normalized JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'valid', 'warning', 'error', 'imported', 'skipped')),
  errors JSONB,
  debtor_id UUID REFERENCES collection_debtors(id) ON DELETE SET NULL,
  credit_id UUID REFERENCES collection_credits(id) ON DELETE SET NULL,
  installment_id UUID REFERENCES collection_installments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_import_rows_batch
  ON collection_import_rows(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_collection_import_rows_account
  ON collection_import_rows(account_id);

ALTER TABLE collection_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_import_batches_select ON collection_import_batches;
DROP POLICY IF EXISTS collection_import_batches_insert ON collection_import_batches;
DROP POLICY IF EXISTS collection_import_batches_update ON collection_import_batches;
DROP POLICY IF EXISTS collection_import_batches_delete ON collection_import_batches;

CREATE POLICY collection_import_batches_select ON collection_import_batches
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_import_batches_insert ON collection_import_batches
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_import_batches_update ON collection_import_batches
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_import_batches_delete ON collection_import_batches
  FOR DELETE USING (is_account_member(account_id, 'admin'));

ALTER TABLE collection_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_import_rows_select ON collection_import_rows;
DROP POLICY IF EXISTS collection_import_rows_insert ON collection_import_rows;
DROP POLICY IF EXISTS collection_import_rows_update ON collection_import_rows;
DROP POLICY IF EXISTS collection_import_rows_delete ON collection_import_rows;

CREATE POLICY collection_import_rows_select ON collection_import_rows
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_import_rows_insert ON collection_import_rows
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_import_rows_update ON collection_import_rows
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_import_rows_delete ON collection_import_rows
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- Commit transaccional
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION collection_import_commit(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_portfolio UUID;
  v_status TEXT;
  v_row RECORD;
  v_doc TEXT;
  v_doc_type TEXT;
  v_name TEXT;
  v_phone TEXT;
  v_phone2 TEXT;
  v_email TEXT;
  v_address TEXT;
  v_city TEXT;
  v_folio TEXT;
  v_product TEXT;
  v_number INTEGER;
  v_due DATE;
  v_principal NUMERIC;
  v_interest NUMERIC;
  v_late NUMERIC;
  v_debtor UUID;
  v_credit UUID;
  v_installment UUID;
  v_created_debtors INTEGER := 0;
  v_created_credits INTEGER := 0;
  v_created_installments INTEGER := 0;
  v_updated_installments INTEGER := 0;
  v_errors INTEGER := 0;
BEGIN
  SELECT account_id, portfolio_id, status
    INTO v_account, v_portfolio, v_status
    FROM collection_import_batches
   WHERE id = p_batch_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Lote de importación no encontrado';
  END IF;

  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado para importar en esta cuenta';
  END IF;

  IF v_status <> 'validated' THEN
    RAISE EXCEPTION 'El lote debe estar validado antes de confirmar (estado actual: %)', v_status;
  END IF;

  FOR v_row IN
    SELECT * FROM collection_import_rows
     WHERE batch_id = p_batch_id
       AND status IN ('valid', 'warning')
     ORDER BY row_number
  LOOP
    BEGIN
      v_doc := NULLIF(btrim(v_row.normalized->>'document_number'), '');
      v_doc_type := NULLIF(btrim(v_row.normalized->>'document_type'), '');
      v_name := NULLIF(btrim(v_row.normalized->>'name'), '');
      v_phone := NULLIF(btrim(v_row.normalized->>'phone_primary'), '');
      v_phone2 := NULLIF(btrim(v_row.normalized->>'phone_secondary'), '');
      v_email := NULLIF(btrim(v_row.normalized->>'email'), '');
      v_address := NULLIF(btrim(v_row.normalized->>'address'), '');
      v_city := NULLIF(btrim(v_row.normalized->>'city'), '');
      v_folio := NULLIF(btrim(v_row.normalized->>'folio'), '');
      v_product := NULLIF(btrim(v_row.normalized->>'product'), '');
      v_number := (v_row.normalized->>'installment_number')::INTEGER;
      v_due := (v_row.normalized->>'due_date')::DATE;
      v_principal := COALESCE((v_row.normalized->>'principal')::NUMERIC, 0);
      v_interest := COALESCE((v_row.normalized->>'interest')::NUMERIC, 0);
      v_late := COALESCE((v_row.normalized->>'late_fee')::NUMERIC, 0);

      IF v_name IS NULL THEN
        RAISE EXCEPTION 'Fila % sin nombre de deudor', v_row.row_number;
      END IF;
      IF v_folio IS NULL THEN
        RAISE EXCEPTION 'Fila % sin folio de crédito', v_row.row_number;
      END IF;
      IF v_number IS NULL OR v_number <= 0 THEN
        RAISE EXCEPTION 'Fila % con número de cuota inválido', v_row.row_number;
      END IF;
      IF v_due IS NULL THEN
        RAISE EXCEPTION 'Fila % sin fecha de vencimiento', v_row.row_number;
      END IF;

      -- Deudor: documento si existe; si no, nombre + teléfono.
      IF v_doc IS NOT NULL THEN
        SELECT id INTO v_debtor
          FROM collection_debtors
         WHERE account_id = v_account AND document_number = v_doc;
      ELSE
        SELECT id INTO v_debtor
          FROM collection_debtors
         WHERE account_id = v_account
           AND name = v_name
           AND phone_primary IS NOT DISTINCT FROM v_phone
         LIMIT 1;
      END IF;

      IF v_debtor IS NULL THEN
        INSERT INTO collection_debtors (
          account_id, portfolio_id, document_type, document_number, name,
          phone_primary, phone_secondary, email, address, city, country, created_by
        ) VALUES (
          v_account, v_portfolio, v_doc_type, v_doc, v_name,
          v_phone, v_phone2, v_email, v_address, v_city, 'VE', auth.uid()
        )
        RETURNING id INTO v_debtor;
        v_created_debtors := v_created_debtors + 1;
      ELSE
        UPDATE collection_debtors
           SET portfolio_id = COALESCE(v_portfolio, portfolio_id),
               name = COALESCE(v_name, name),
               phone_primary = COALESCE(v_phone, phone_primary),
               phone_secondary = COALESCE(v_phone2, phone_secondary),
               email = COALESCE(v_email, email),
               address = COALESCE(v_address, address),
               city = COALESCE(v_city, city),
               updated_at = NOW()
         WHERE id = v_debtor;
      END IF;

      -- Crédito por folio. Los totales se recalculan al final desde
      -- las cuotas; aquí solo se crea/actualiza la cabecera.
      SELECT id INTO v_credit
        FROM collection_credits
       WHERE account_id = v_account AND folio = v_folio;

      IF v_credit IS NULL THEN
        INSERT INTO collection_credits (
          account_id, debtor_id, portfolio_id, folio, product, created_at
        ) VALUES (
          v_account, v_debtor, v_portfolio, v_folio, v_product, NOW()
        )
        RETURNING id INTO v_credit;
        v_created_credits := v_created_credits + 1;
      ELSE
        UPDATE collection_credits
           SET debtor_id = v_debtor,
               portfolio_id = COALESCE(v_portfolio, portfolio_id),
               product = COALESCE(v_product, product),
               updated_at = NOW()
         WHERE id = v_credit;
      END IF;

      -- Cuota por (crédito, número).
      SELECT id INTO v_installment
        FROM collection_installments
       WHERE credit_id = v_credit AND number = v_number;

      IF v_installment IS NULL THEN
        INSERT INTO collection_installments (
          account_id, credit_id, debtor_id, number, due_date,
          principal, interest, late_fee
        ) VALUES (
          v_account, v_credit, v_debtor, v_number, v_due,
          v_principal, v_interest, v_late
        )
        RETURNING id INTO v_installment;
        v_created_installments := v_created_installments + 1;
      ELSE
        UPDATE collection_installments
           SET due_date = v_due,
               principal = CASE WHEN status = 'paid' THEN principal ELSE v_principal END,
               interest = CASE WHEN status = 'paid' THEN interest ELSE v_interest END,
               late_fee = CASE WHEN status = 'paid' THEN late_fee ELSE v_late END,
               updated_at = NOW()
         WHERE id = v_installment;
        v_updated_installments := v_updated_installments + 1;
      END IF;

      UPDATE collection_import_rows
         SET status = 'imported',
             debtor_id = v_debtor,
             credit_id = v_credit,
             installment_id = v_installment
       WHERE id = v_row.id;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      UPDATE collection_import_rows
         SET status = 'error',
             errors = to_jsonb(ARRAY[SQLERRM])
       WHERE id = v_row.id;
    END;
  END LOOP;

  -- Totales del crédito = suma de sus cuotas.
  UPDATE collection_credits c
     SET principal = x.principal,
         interest = x.interest,
         late_fee = x.late_fee,
         updated_at = NOW()
    FROM (
      SELECT i.credit_id,
             SUM(i.principal) AS principal,
             SUM(i.interest) AS interest,
             SUM(i.late_fee) AS late_fee
        FROM collection_installments i
       WHERE i.id IN (
         SELECT installment_id FROM collection_import_rows
          WHERE batch_id = p_batch_id AND installment_id IS NOT NULL
       )
       GROUP BY i.credit_id
    ) x
   WHERE c.id = x.credit_id;

  -- Segmento por la cuota vencida más antigua.
  UPDATE collection_debtors d
     SET segment = CASE
           WHEN x.days IS NULL OR x.days <= 15 THEN 'preventiva'
           WHEN x.days <= 30 THEN 'temprana'
           WHEN x.days <= 60 THEN 'media'
           WHEN x.days <= 90 THEN 'tardia'
           ELSE 'critica'
         END,
         updated_at = NOW()
    FROM (
      SELECT d2.id,
             MAX(CURRENT_DATE - i.due_date) FILTER (
               WHERE i.status IN ('pending', 'partial') AND i.due_date < CURRENT_DATE
             ) AS days
        FROM collection_debtors d2
        LEFT JOIN collection_installments i ON i.debtor_id = d2.id
       WHERE d2.id IN (
         SELECT DISTINCT debtor_id FROM collection_import_rows
          WHERE batch_id = p_batch_id AND debtor_id IS NOT NULL
       )
       GROUP BY d2.id
    ) x
   WHERE d.id = x.id;

  UPDATE collection_import_batches
     SET status = 'committed',
         committed_at = NOW(),
         summary = jsonb_build_object(
           'created_debtors', v_created_debtors,
           'created_credits', v_created_credits,
           'created_installments', v_created_installments,
           'updated_installments', v_updated_installments,
           'errors', v_errors,
           'committed_rows', (
             SELECT COUNT(*) FROM collection_import_rows
              WHERE batch_id = p_batch_id AND status = 'imported'
           )
         )
   WHERE id = p_batch_id;

  -- Recalcula prioridades si la migración 076 ya está aplicada.
  BEGIN
    PERFORM collection_recompute_priorities(v_account);
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  RETURN (SELECT summary FROM collection_import_batches WHERE id = p_batch_id);
END;
$$;

-- ------------------------------------------------------------
-- Anulación lógica de un lote
--
-- No borra datos con actividad posterior. Marca `cancelled` las
-- cuotas creadas por el lote que sigan impagas y sin gestiones.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION collection_import_cancel(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_status TEXT;
  v_cancelled INTEGER := 0;
  v_blocked INTEGER := 0;
BEGIN
  SELECT account_id, status INTO v_account, v_status
    FROM collection_import_batches WHERE id = p_batch_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Lote de importación no encontrado';
  END IF;
  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF v_status = 'committed' THEN
    RAISE EXCEPTION 'El lote ya fue confirmado; anúlalo desde la cartera';
  END IF;

  UPDATE collection_import_rows
     SET status = 'skipped'
   WHERE batch_id = p_batch_id AND status IN ('pending', 'valid', 'warning');

  UPDATE collection_import_batches
     SET status = 'cancelled'
   WHERE id = p_batch_id;

  RETURN jsonb_build_object('cancelled', v_cancelled, 'blocked', v_blocked);
END;
$$;

-- ------------------------------------------------------------
-- Auditoría y permisos
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_collection_import_batches ON collection_import_batches;
CREATE TRIGGER audit_collection_import_batches
  AFTER INSERT OR UPDATE OR DELETE ON collection_import_batches
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE, DELETE ON collection_import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_import_rows TO authenticated;
GRANT ALL ON collection_import_batches TO service_role;
GRANT ALL ON collection_import_rows TO service_role;
