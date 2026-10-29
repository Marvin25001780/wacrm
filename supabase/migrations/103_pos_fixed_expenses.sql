-- ============================================================
-- 103_pos_fixed_expenses.sql — Gastos fijos mensuales y sus pagos
--
-- * Los gastos fijos son compromisos del mes (alquiler, internet,
--   sueldos...) que no siempre salen de una cuenta el mismo día.
-- * No mueven dinero por sí solos: son el presupuesto contra el que
--   Informes calcula cuánto hay que vender al día para cubrirlos.
-- * Al pagarlos se registra el gasto real en Finanzas y queda la fecha
--   de pago, para saber qué está cubierto este mes y qué no.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_fixed_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  amount_usd NUMERIC(14,2) NOT NULL CHECK (amount_usd >= 0),
  due_day INTEGER NOT NULL DEFAULT 1 CHECK (due_day BETWEEN 1 AND 31),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_fixed_expenses_account
  ON pos_fixed_expenses(account_id, active);

ALTER TABLE pos_fixed_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_fixed_expenses_select ON pos_fixed_expenses;
DROP POLICY IF EXISTS pos_fixed_expenses_write ON pos_fixed_expenses;
CREATE POLICY pos_fixed_expenses_select ON pos_fixed_expenses
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_fixed_expenses_write ON pos_fixed_expenses
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- Pagos: un registro por gasto fijo y mes.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_fixed_expense_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fixed_expense_id UUID NOT NULL
    REFERENCES pos_fixed_expenses(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  amount_usd NUMERIC(14,2) NOT NULL CHECK (amount_usd > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pos_account_id UUID REFERENCES pos_accounts(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fixed_expense_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_pos_fixed_expense_payments_period
  ON pos_fixed_expense_payments(account_id, period_month);

ALTER TABLE pos_fixed_expense_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_fixed_expense_payments_select
  ON pos_fixed_expense_payments;
DROP POLICY IF EXISTS pos_fixed_expense_payments_write
  ON pos_fixed_expense_payments;
CREATE POLICY pos_fixed_expense_payments_select
  ON pos_fixed_expense_payments
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_fixed_expense_payments_write
  ON pos_fixed_expense_payments
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.pos_fixed_expenses,
  public.pos_fixed_expense_payments
TO authenticated;

NOTIFY pgrst, 'reload schema';
