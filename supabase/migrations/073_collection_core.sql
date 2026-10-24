-- ============================================================
-- 073_collection_core.sql - Núcleo del módulo Cobranza
--
-- Modelo de cartera para recuperación de créditos:
--   deudor 1:N créditos 1:N cuotas 1:N pagos
--
-- A diferencia de `receivables` (una cuenta = un concepto), aquí
-- una cuota es una fila y el saldo se deriva de `total - paid_amount`.
--
-- Crea:
--   1. collection_settings
--   2. collection_portfolios
--   3. collection_debtors
--   4. collection_credits
--   5. collection_installments
--   6. collection_payments
--   7. Triggers de consistencia y recálculo de saldos
--
-- Idempotente - seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- 1. Configuración por cuenta
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL DEFAULT 'VE',
  timezone TEXT NOT NULL DEFAULT 'America/Caracas',
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  business_hours_start TIME NOT NULL DEFAULT '09:00',
  business_hours_end TIME NOT NULL DEFAULT '18:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE collection_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_settings_select ON collection_settings;
DROP POLICY IF EXISTS collection_settings_insert ON collection_settings;
DROP POLICY IF EXISTS collection_settings_update ON collection_settings;
DROP POLICY IF EXISTS collection_settings_delete ON collection_settings;

CREATE POLICY collection_settings_select ON collection_settings
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_settings_insert ON collection_settings
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY collection_settings_update ON collection_settings
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY collection_settings_delete ON collection_settings
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON collection_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON collection_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. Carteras (lotes lógicos de carga)
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'excel', 'csv', 'api')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'archived')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_portfolios_account
  ON collection_portfolios(account_id, status);

ALTER TABLE collection_portfolios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_portfolios_select ON collection_portfolios;
DROP POLICY IF EXISTS collection_portfolios_insert ON collection_portfolios;
DROP POLICY IF EXISTS collection_portfolios_update ON collection_portfolios;
DROP POLICY IF EXISTS collection_portfolios_delete ON collection_portfolios;

CREATE POLICY collection_portfolios_select ON collection_portfolios
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_portfolios_insert ON collection_portfolios
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_portfolios_update ON collection_portfolios
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_portfolios_delete ON collection_portfolios
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON collection_portfolios;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON collection_portfolios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. Deudores
--
-- Una fila por persona/empresa. `document_number` es la clave
-- natural; si no existe, la app usa nombre + teléfono como clave
-- débil (nunca se inventa un documento).
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_debtors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES collection_portfolios(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  document_type TEXT
    CHECK (document_type IN ('dni', 'cedula', 'rfc', 'passport', 'other')),
  document_number TEXT,
  name TEXT NOT NULL,
  phone_primary TEXT,
  phone_secondary TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  country TEXT DEFAULT 'VE',
  segment TEXT NOT NULL DEFAULT 'preventiva'
    CHECK (segment IN ('preventiva', 'temprana', 'media', 'tardia', 'critica')),
  status TEXT NOT NULL DEFAULT 'nuevo'
    CHECK (status IN ('nuevo', 'contactado', 'negociacion', 'acuerdo', 'pagado', 'ilocalizable', 'juridico')),
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  priority_score NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (priority_score >= 0 AND priority_score <= 100),
  priority_reason TEXT,
  priority_updated_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_debtors_document
  ON collection_debtors(account_id, document_number)
  WHERE document_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_collection_debtors_account_status
  ON collection_debtors(account_id, status);
CREATE INDEX IF NOT EXISTS idx_collection_debtors_account_segment
  ON collection_debtors(account_id, segment);
CREATE INDEX IF NOT EXISTS idx_collection_debtors_phone
  ON collection_debtors(account_id, phone_primary);
CREATE INDEX IF NOT EXISTS idx_collection_debtors_assigned
  ON collection_debtors(account_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_collection_debtors_priority
  ON collection_debtors(account_id, priority_score DESC);

ALTER TABLE collection_debtors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_debtors_select ON collection_debtors;
DROP POLICY IF EXISTS collection_debtors_insert ON collection_debtors;
DROP POLICY IF EXISTS collection_debtors_update ON collection_debtors;
DROP POLICY IF EXISTS collection_debtors_delete ON collection_debtors;

CREATE POLICY collection_debtors_select ON collection_debtors
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_debtors_insert ON collection_debtors
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_debtors_update ON collection_debtors
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_debtors_delete ON collection_debtors
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON collection_debtors;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON collection_debtors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 4. Créditos
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES collection_portfolios(id) ON DELETE SET NULL,
  folio TEXT NOT NULL,
  product TEXT,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  principal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  interest NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (interest >= 0),
  late_fee NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  total NUMERIC(14, 2) GENERATED ALWAYS AS (principal + interest + late_fee) STORED,
  opened_at DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paid', 'restructured', 'legal', 'cancelled')),
  legacy_receivable_id UUID UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_credits_folio
  ON collection_credits(account_id, folio);

CREATE INDEX IF NOT EXISTS idx_collection_credits_debtor
  ON collection_credits(debtor_id, status);
CREATE INDEX IF NOT EXISTS idx_collection_credits_portfolio
  ON collection_credits(portfolio_id, status);

ALTER TABLE collection_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_credits_select ON collection_credits;
DROP POLICY IF EXISTS collection_credits_insert ON collection_credits;
DROP POLICY IF EXISTS collection_credits_update ON collection_credits;
DROP POLICY IF EXISTS collection_credits_delete ON collection_credits;

CREATE POLICY collection_credits_select ON collection_credits
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_credits_insert ON collection_credits
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_credits_update ON collection_credits
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_credits_delete ON collection_credits
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON collection_credits;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON collection_credits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 5. Cuotas
--
-- `debtor_id` está denormalizado para acelerar la cartera. El
-- trigger `collection_sync_installment_debtor` lo copia del crédito
-- y rechaza cualquier intento de apuntar a otro deudor.
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  credit_id UUID NOT NULL REFERENCES collection_credits(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  due_date DATE NOT NULL,
  principal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  interest NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (interest >= 0),
  late_fee NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  total NUMERIC(14, 2) GENERATED ALWAYS AS (principal + interest + late_fee) STORED,
  paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partial', 'paid', 'cancelled')),
  paid_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_installments_number
  ON collection_installments(credit_id, number);

CREATE INDEX IF NOT EXISTS idx_collection_installments_due
  ON collection_installments(account_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_collection_installments_debtor
  ON collection_installments(debtor_id, status);

ALTER TABLE collection_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_installments_select ON collection_installments;
DROP POLICY IF EXISTS collection_installments_insert ON collection_installments;
DROP POLICY IF EXISTS collection_installments_update ON collection_installments;
DROP POLICY IF EXISTS collection_installments_delete ON collection_installments;

CREATE POLICY collection_installments_select ON collection_installments
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_installments_insert ON collection_installments
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_installments_update ON collection_installments
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_installments_delete ON collection_installments
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON collection_installments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON collection_installments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Copia account_id + debtor_id desde el crédito.
CREATE OR REPLACE FUNCTION collection_sync_installment_debtor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_debtor UUID;
BEGIN
  SELECT account_id, debtor_id INTO v_account, v_debtor
    FROM collection_credits
   WHERE id = NEW.credit_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'El crédito % no existe', NEW.credit_id;
  END IF;

  NEW.account_id := v_account;
  NEW.debtor_id := v_debtor;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_sync_installment_debtor ON collection_installments;
CREATE TRIGGER collection_sync_installment_debtor
  BEFORE INSERT OR UPDATE OF credit_id, debtor_id, account_id
  ON collection_installments
  FOR EACH ROW EXECUTE FUNCTION collection_sync_installment_debtor();

-- ============================================================
-- 6. Pagos
--
-- Un pago aplica a una cuota. Si el cliente paga varias cuotas,
-- la app inserta N filas con la misma referencia.
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  installment_id UUID NOT NULL REFERENCES collection_installments(id) ON DELETE CASCADE,
  credit_id UUID NOT NULL REFERENCES collection_credits(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  method TEXT CHECK (method IN ('cash', 'transfer', 'card', 'check', 'other')),
  reference TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'import', 'link', 'adjustment')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_payments_installment
  ON collection_payments(installment_id);
CREATE INDEX IF NOT EXISTS idx_collection_payments_account_date
  ON collection_payments(account_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_collection_payments_credit
  ON collection_payments(credit_id, paid_at);

ALTER TABLE collection_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_payments_select ON collection_payments;
DROP POLICY IF EXISTS collection_payments_insert ON collection_payments;
DROP POLICY IF EXISTS collection_payments_update ON collection_payments;
DROP POLICY IF EXISTS collection_payments_delete ON collection_payments;

CREATE POLICY collection_payments_select ON collection_payments
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_payments_insert ON collection_payments
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_payments_update ON collection_payments
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_payments_delete ON collection_payments
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Valida que el pago no exceda la cuota y copia las claves
-- desde la cuota (nunca confía en el cliente).
CREATE OR REPLACE FUNCTION collection_validate_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_credit UUID;
  v_debtor UUID;
  v_total NUMERIC;
  v_other NUMERIC;
BEGIN
  SELECT account_id, credit_id, debtor_id, total
    INTO v_account, v_credit, v_debtor, v_total
    FROM collection_installments
   WHERE id = NEW.installment_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'La cuota % no existe', NEW.installment_id;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_other
    FROM collection_payments
   WHERE installment_id = NEW.installment_id
     AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF v_other + NEW.amount > v_total + 0.005 THEN
    RAISE EXCEPTION 'El pago excede el saldo de la cuota (saldo %, pago %)',
      (v_total - v_other), NEW.amount;
  END IF;

  NEW.account_id := v_account;
  NEW.credit_id := v_credit;
  NEW.debtor_id := v_debtor;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_validate_payment ON collection_payments;
CREATE TRIGGER collection_validate_payment
  BEFORE INSERT OR UPDATE ON collection_payments
  FOR EACH ROW EXECUTE FUNCTION collection_validate_payment();

-- Recalcula cuota -> crédito -> deudor después de cada pago.
CREATE OR REPLACE FUNCTION collection_recompute_after_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_installment UUID;
  v_credit UUID;
  v_debtor UUID;
  v_total NUMERIC;
  v_paid NUMERIC;
  v_status TEXT;
BEGIN
  v_installment := COALESCE(NEW.installment_id, OLD.installment_id);

  SELECT credit_id, debtor_id, total
    INTO v_credit, v_debtor, v_total
    FROM collection_installments
   WHERE id = v_installment;

  IF v_credit IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM collection_payments
   WHERE installment_id = v_installment;

  v_status := CASE
    WHEN v_paid <= 0 THEN 'pending'
    WHEN v_paid >= v_total THEN 'paid'
    ELSE 'partial'
  END;

  UPDATE collection_installments
     SET paid_amount = v_paid,
         status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE v_status END,
         paid_at = CASE WHEN v_status = 'paid' THEN COALESCE(paid_at, CURRENT_DATE) ELSE NULL END,
         updated_at = NOW()
   WHERE id = v_installment;

  UPDATE collection_credits c
     SET status = CASE
           WHEN c.status IN ('cancelled', 'restructured', 'legal') THEN c.status
           WHEN NOT EXISTS (
             SELECT 1 FROM collection_installments i
              WHERE i.credit_id = c.id AND i.status NOT IN ('paid', 'cancelled')
           ) THEN 'paid'
           ELSE 'active'
         END,
         updated_at = NOW()
   WHERE c.id = v_credit;

  UPDATE collection_debtors d
     SET status = CASE
           WHEN d.status IN ('ilocalizable', 'juridico') THEN d.status
           WHEN NOT EXISTS (
             SELECT 1 FROM collection_credits c
              WHERE c.debtor_id = d.id AND c.status NOT IN ('paid', 'cancelled')
           ) AND EXISTS (
             SELECT 1 FROM collection_credits c
              WHERE c.debtor_id = d.id AND c.status = 'paid'
           ) THEN 'pagado'
           ELSE d.status
         END,
         updated_at = NOW()
   WHERE d.id = v_debtor;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS collection_recompute_after_payment ON collection_payments;
CREATE TRIGGER collection_recompute_after_payment
  AFTER INSERT OR UPDATE OR DELETE ON collection_payments
  FOR EACH ROW EXECUTE FUNCTION collection_recompute_after_payment();

-- ============================================================
-- 7. Auditoría y permisos
-- ============================================================
DROP TRIGGER IF EXISTS audit_collection_debtors ON collection_debtors;
CREATE TRIGGER audit_collection_debtors
  AFTER INSERT OR UPDATE OR DELETE ON collection_debtors
  FOR EACH ROW EXECUTE FUNCTION audit_row();

DROP TRIGGER IF EXISTS audit_collection_credits ON collection_credits;
CREATE TRIGGER audit_collection_credits
  AFTER INSERT OR UPDATE OR DELETE ON collection_credits
  FOR EACH ROW EXECUTE FUNCTION audit_row();

DROP TRIGGER IF EXISTS audit_collection_installments ON collection_installments;
CREATE TRIGGER audit_collection_installments
  AFTER INSERT OR UPDATE OR DELETE ON collection_installments
  FOR EACH ROW EXECUTE FUNCTION audit_row();

DROP TRIGGER IF EXISTS audit_collection_payments ON collection_payments;
CREATE TRIGGER audit_collection_payments
  AFTER INSERT OR UPDATE OR DELETE ON collection_payments
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE, DELETE ON collection_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_portfolios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_debtors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_credits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_installments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_payments TO authenticated;

GRANT ALL ON collection_settings TO service_role;
GRANT ALL ON collection_portfolios TO service_role;
GRANT ALL ON collection_debtors TO service_role;
GRANT ALL ON collection_credits TO service_role;
GRANT ALL ON collection_installments TO service_role;
GRANT ALL ON collection_payments TO service_role;
