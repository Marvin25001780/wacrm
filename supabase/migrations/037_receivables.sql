-- ============================================================
-- 037_receivables.sql — Cobranza (cuentas por cobrar)  ·  módulo 2.2
--
-- Una "cuenta por cobrar" (receivable) es un importe que un cliente
-- debe pagar: concepto, monto, moneda, fecha de vencimiento y estado.
-- Se vincula opcionalmente a un contacto, una empresa y/o una oferta.
--
-- Los ABONOS (receivable_payments) se registran contra la cuenta; el
-- SALDO = monto − suma(abonos). El estado (pending/partial/paid) se
-- mantiene automáticamente con un trigger sobre los abonos; la app
-- solo fija manualmente 'cancelled'.
--
-- Crea:
--   1. `receivables`          — la cuenta por cobrar.
--   2. `receivable_payments`  — abonos.
--   3. `recompute_receivable_status()` — trigger de estado.
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- 1. receivables
-- ============================================================
CREATE TABLE IF NOT EXISTS receivables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Tenancy key — NOT NULL.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Vínculos opcionales (se preserva el historial: SET NULL al borrar).
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  concept TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  due_date DATE,
  -- pending | partial | paid los mantiene el trigger; cancelled es manual.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partial', 'paid', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receivables_account ON receivables(account_id);
CREATE INDEX IF NOT EXISTS idx_receivables_status ON receivables(account_id, status);
CREATE INDEX IF NOT EXISTS idx_receivables_due ON receivables(account_id, due_date);
CREATE INDEX IF NOT EXISTS idx_receivables_contact ON receivables(contact_id);

ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receivables_select ON receivables;
DROP POLICY IF EXISTS receivables_insert ON receivables;
DROP POLICY IF EXISTS receivables_update ON receivables;
DROP POLICY IF EXISTS receivables_delete ON receivables;

CREATE POLICY receivables_select ON receivables
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY receivables_insert ON receivables
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY receivables_update ON receivables
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY receivables_delete ON receivables
  FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON receivables;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON receivables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. receivable_payments — abonos
-- ============================================================
CREATE TABLE IF NOT EXISTS receivable_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receivable_id UUID NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
  -- Redundante con receivables.account_id, pero simplifica las políticas RLS.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  method TEXT CHECK (method IN ('cash', 'transfer', 'card', 'check', 'other')),
  reference TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recv_payments_receivable ON receivable_payments(receivable_id);
CREATE INDEX IF NOT EXISTS idx_recv_payments_account ON receivable_payments(account_id);

ALTER TABLE receivable_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receivable_payments_select ON receivable_payments;
DROP POLICY IF EXISTS receivable_payments_insert ON receivable_payments;
DROP POLICY IF EXISTS receivable_payments_update ON receivable_payments;
DROP POLICY IF EXISTS receivable_payments_delete ON receivable_payments;

CREATE POLICY receivable_payments_select ON receivable_payments
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY receivable_payments_insert ON receivable_payments
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY receivable_payments_update ON receivable_payments
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY receivable_payments_delete ON receivable_payments
  FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- 3. recompute_receivable_status — mantiene pending/partial/paid
--    a partir de la suma de abonos. 'cancelled' es pegajoso.
-- ============================================================
CREATE OR REPLACE FUNCTION recompute_receivable_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rid UUID;
  total NUMERIC;
  amt NUMERIC;
BEGIN
  rid := COALESCE(NEW.receivable_id, OLD.receivable_id);

  SELECT COALESCE(SUM(amount), 0) INTO total
    FROM receivable_payments WHERE receivable_id = rid;
  SELECT amount INTO amt FROM receivables WHERE id = rid;

  IF amt IS NULL THEN
    RETURN NULL; -- la cuenta ya no existe
  END IF;

  UPDATE receivables
     SET status = CASE
           WHEN status = 'cancelled' THEN 'cancelled'
           WHEN total >= amt THEN 'paid'
           WHEN total > 0 THEN 'partial'
           ELSE 'pending'
         END,
         updated_at = NOW()
   WHERE id = rid;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_receivable_status ON receivable_payments;
CREATE TRIGGER trg_recompute_receivable_status
  AFTER INSERT OR UPDATE OR DELETE ON receivable_payments
  FOR EACH ROW EXECUTE FUNCTION recompute_receivable_status();
