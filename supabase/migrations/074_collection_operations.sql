-- ============================================================
-- 074_collection_operations.sql - Operación diaria de Cobranza
--
-- Crea:
--   1. collection_outcomes       - catálogo de tipificaciones
--   2. collection_actions        - gestiones del agente
--   3. collection_promises       - acuerdos de pago (PTP)
--   4. collection_assignments    - cola / asignación
--   5. collection_policies       - políticas por tramo
--   6. collection_commission_rules
--   7. Triggers de validación y de cumplimiento de PTP
--
-- Idempotente - seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- 1. Catálogo de tipificaciones
--
-- Las filas con account_id NULL son del sistema y las ve todo el
-- mundo. Una cuenta puede crear sus propios códigos. La app
-- resuelve el label contra este catálogo.
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  level SMALLINT NOT NULL CHECK (level IN (1, 2, 3)),
  parent_code TEXT,
  requires_amount BOOLEAN NOT NULL DEFAULT FALSE,
  requires_date BOOLEAN NOT NULL DEFAULT FALSE,
  requires_reason BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_outcomes_code
  ON collection_outcomes (
    COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::UUID),
    code
  );

CREATE INDEX IF NOT EXISTS idx_collection_outcomes_account
  ON collection_outcomes(account_id, level, sort);

ALTER TABLE collection_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_outcomes_select ON collection_outcomes;
DROP POLICY IF EXISTS collection_outcomes_insert ON collection_outcomes;
DROP POLICY IF EXISTS collection_outcomes_update ON collection_outcomes;
DROP POLICY IF EXISTS collection_outcomes_delete ON collection_outcomes;

CREATE POLICY collection_outcomes_select ON collection_outcomes
  FOR SELECT USING (account_id IS NULL OR is_account_member(account_id));
CREATE POLICY collection_outcomes_insert ON collection_outcomes
  FOR INSERT WITH CHECK (account_id IS NOT NULL AND is_account_member(account_id, 'admin'));
CREATE POLICY collection_outcomes_update ON collection_outcomes
  FOR UPDATE USING (account_id IS NOT NULL AND is_account_member(account_id, 'admin'));
CREATE POLICY collection_outcomes_delete ON collection_outcomes
  FOR DELETE USING (account_id IS NOT NULL AND is_account_member(account_id, 'admin'));

-- Semilla del sistema.
INSERT INTO collection_outcomes
  (account_id, code, label, level, parent_code, requires_amount, requires_date, requires_reason, sort)
SELECT NULL, v.code, v.label, v.level, v.parent_code,
       v.requires_amount, v.requires_date, v.requires_reason, v.sort
FROM (VALUES
  ('contacted',      'Contacto titular',          1, NULL,             FALSE, FALSE, FALSE, 10),
  ('third_party',    'Contacto tercero',          1, NULL,             FALSE, FALSE, FALSE, 20),
  ('no_contact',     'Sin contacto / buzón',      1, NULL,             FALSE, FALSE, FALSE, 30),
  ('wrong_number',   'Número erróneo',            1, NULL,             FALSE, FALSE, FALSE, 40),
  ('ptp',            'Promesa de pago',           2, 'contacted',      TRUE,  TRUE,  FALSE, 10),
  ('refusal',        'Negativa de pago',          2, 'contacted',      FALSE, FALSE, TRUE,  20),
  ('restructure',    'Reestructuración',          2, 'contacted',      FALSE, FALSE, TRUE,  30),
  ('callback',       'Llamar más tarde',          2, 'contacted',      FALSE, TRUE,  FALSE, 40),
  ('payment',        'Pago realizado',            2, 'contacted',      TRUE,  FALSE, FALSE, 50),
  ('ptp_detail',     'Detalle de PTP',            3, 'ptp',            TRUE,  TRUE,  FALSE, 10),
  ('refusal_reason', 'Motivo de negativa',        3, 'refusal',        FALSE, FALSE, TRUE,  10)
) AS v(code, label, level, parent_code, requires_amount, requires_date, requires_reason, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM collection_outcomes o
   WHERE o.account_id IS NULL AND o.code = v.code
);

-- ============================================================
-- 2. Gestiones
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  credit_id UUID REFERENCES collection_credits(id) ON DELETE SET NULL,
  installment_id UUID REFERENCES collection_installments(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'call'
    CHECK (channel IN ('call', 'whatsapp', 'sms', 'email', 'visit', 'other')),
  direction TEXT NOT NULL DEFAULT 'outbound'
    CHECK (direction IN ('outbound', 'inbound')),
  level1_code TEXT NOT NULL,
  level2_code TEXT,
  notes TEXT,
  call_duration_seconds INTEGER CHECK (call_duration_seconds >= 0),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  promise_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_actions_debtor
  ON collection_actions(debtor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_actions_user
  ON collection_actions(account_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_actions_contactability
  ON collection_actions(account_id, level1_code, created_at DESC);

ALTER TABLE collection_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_actions_select ON collection_actions;
DROP POLICY IF EXISTS collection_actions_insert ON collection_actions;
DROP POLICY IF EXISTS collection_actions_update ON collection_actions;
DROP POLICY IF EXISTS collection_actions_delete ON collection_actions;

CREATE POLICY collection_actions_select ON collection_actions
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_actions_insert ON collection_actions
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_actions_update ON collection_actions
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_actions_delete ON collection_actions
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Validación mínima de tipificación. La validación de políticas
-- (topes diarios, ventana horaria) se hace en la capa de servicio
-- porque depende del tramo y del historial del deudor.
CREATE OR REPLACE FUNCTION collection_validate_action()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM collection_outcomes o
     WHERE o.code = NEW.level1_code
       AND o.level = 1
       AND o.active
       AND (o.account_id IS NULL OR o.account_id = NEW.account_id)
  ) THEN
    RAISE EXCEPTION 'Tipificación de nivel 1 desconocida: %', NEW.level1_code;
  END IF;

  IF NEW.level1_code IN ('contacted', 'third_party') AND NEW.level2_code IS NULL THEN
    RAISE EXCEPTION 'Una gestión con contacto exige tipificación de nivel 2';
  END IF;

  IF NEW.level2_code IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM collection_outcomes o
     WHERE o.code = NEW.level2_code
       AND o.level = 2
       AND o.active
       AND (o.account_id IS NULL OR o.account_id = NEW.account_id)
  ) THEN
    RAISE EXCEPTION 'Tipificación de nivel 2 desconocida: %', NEW.level2_code;
  END IF;

  IF NEW.level2_code = 'refusal' AND (NEW.notes IS NULL OR btrim(NEW.notes) = '') THEN
    RAISE EXCEPTION 'Una negativa de pago exige motivo en las notas';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_validate_action ON collection_actions;
CREATE TRIGGER collection_validate_action
  BEFORE INSERT OR UPDATE ON collection_actions
  FOR EACH ROW EXECUTE FUNCTION collection_validate_action();

-- ============================================================
-- 3. Acuerdos de pago (PTP)
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_promises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  credit_id UUID NOT NULL REFERENCES collection_credits(id) ON DELETE CASCADE,
  action_id UUID REFERENCES collection_actions(id) ON DELETE SET NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'kept', 'partial', 'broken', 'cancelled')),
  paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  channel TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE collection_actions
  DROP CONSTRAINT IF EXISTS collection_actions_promise_fk;
ALTER TABLE collection_actions
  ADD CONSTRAINT collection_actions_promise_fk
  FOREIGN KEY (promise_id) REFERENCES collection_promises(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_collection_promises_due
  ON collection_promises(account_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_collection_promises_debtor
  ON collection_promises(debtor_id, status);

ALTER TABLE collection_promises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_promises_select ON collection_promises;
DROP POLICY IF EXISTS collection_promises_insert ON collection_promises;
DROP POLICY IF EXISTS collection_promises_update ON collection_promises;
DROP POLICY IF EXISTS collection_promises_delete ON collection_promises;

CREATE POLICY collection_promises_select ON collection_promises
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_promises_insert ON collection_promises
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_promises_update ON collection_promises
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_promises_delete ON collection_promises
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON collection_promises;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON collection_promises
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Un pago actualiza las PTP abiertas del mismo crédito. Solo cuentan
-- los pagos registrados después de crear la promesa y con fecha de
-- pago no posterior al vencimiento comprometido.
CREATE OR REPLACE FUNCTION collection_update_promises_after_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credit UUID;
BEGIN
  v_credit := COALESCE(NEW.credit_id, OLD.credit_id);

  IF v_credit IS NULL THEN
    RETURN NULL;
  END IF;

  WITH totals AS (
    SELECT p.id, COALESCE(SUM(pay.amount), 0) AS total
      FROM collection_promises p
      LEFT JOIN collection_payments pay
        ON pay.credit_id = p.credit_id
       AND pay.created_at >= p.created_at
       AND pay.paid_at <= p.due_date
     WHERE p.credit_id = v_credit
       AND p.status IN ('pending', 'partial')
     GROUP BY p.id
  )
  UPDATE collection_promises p
     SET paid_amount = t.total,
         status = CASE
           WHEN t.total >= p.amount THEN 'kept'
           WHEN t.total > 0 THEN 'partial'
           ELSE 'pending'
         END,
         resolved_at = CASE WHEN t.total >= p.amount THEN NOW() ELSE NULL END,
         updated_at = NOW()
    FROM totals t
   WHERE p.id = t.id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS collection_update_promises_after_payment ON collection_payments;
CREATE TRIGGER collection_update_promises_after_payment
  AFTER INSERT OR UPDATE OR DELETE ON collection_payments
  FOR EACH ROW EXECUTE FUNCTION collection_update_promises_after_payment();

-- ============================================================
-- 4. Asignaciones / cola
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  queue TEXT NOT NULL DEFAULT 'general'
    CHECK (queue IN ('general', 'senior', 'legal', 'whatsapp')),
  priority_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'done', 'reassigned', 'expired')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_assignments_active
  ON collection_assignments(debtor_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_collection_assignments_user
  ON collection_assignments(account_id, user_id, status);

ALTER TABLE collection_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_assignments_select ON collection_assignments;
DROP POLICY IF EXISTS collection_assignments_insert ON collection_assignments;
DROP POLICY IF EXISTS collection_assignments_update ON collection_assignments;
DROP POLICY IF EXISTS collection_assignments_delete ON collection_assignments;

CREATE POLICY collection_assignments_select ON collection_assignments
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_assignments_insert ON collection_assignments
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY collection_assignments_update ON collection_assignments
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY collection_assignments_delete ON collection_assignments
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 5. Políticas por tramo
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tramo TEXT NOT NULL
    CHECK (tramo IN ('1_15', '16_30', '31_60', '61_90', '90_plus')),
  max_discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (max_discount_pct >= 0 AND max_discount_pct <= 100),
  max_attempts_per_day INTEGER NOT NULL DEFAULT 3
    CHECK (max_attempts_per_day > 0),
  allowed_start TIME NOT NULL DEFAULT '09:00',
  allowed_end TIME NOT NULL DEFAULT '18:00',
  ptp_max_days INTEGER NOT NULL DEFAULT 7 CHECK (ptp_max_days > 0),
  ptp_grace_days INTEGER NOT NULL DEFAULT 0 CHECK (ptp_grace_days >= 0),
  min_down_payment_pct NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (min_down_payment_pct >= 0 AND min_down_payment_pct <= 100),
  target_recovery_pct NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (target_recovery_pct >= 0 AND target_recovery_pct <= 100),
  script_template TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, tramo)
);

ALTER TABLE collection_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_policies_select ON collection_policies;
DROP POLICY IF EXISTS collection_policies_insert ON collection_policies;
DROP POLICY IF EXISTS collection_policies_update ON collection_policies;
DROP POLICY IF EXISTS collection_policies_delete ON collection_policies;

CREATE POLICY collection_policies_select ON collection_policies
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_policies_insert ON collection_policies
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY collection_policies_update ON collection_policies
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY collection_policies_delete ON collection_policies
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON collection_policies;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON collection_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 6. Reglas de comisión
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tramo TEXT NOT NULL
    CHECK (tramo IN ('1_15', '16_30', '31_60', '61_90', '90_plus')),
  percentage NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (percentage >= 0 AND percentage <= 100),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, tramo)
);

ALTER TABLE collection_commission_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_commission_rules_select ON collection_commission_rules;
DROP POLICY IF EXISTS collection_commission_rules_insert ON collection_commission_rules;
DROP POLICY IF EXISTS collection_commission_rules_update ON collection_commission_rules;
DROP POLICY IF EXISTS collection_commission_rules_delete ON collection_commission_rules;

CREATE POLICY collection_commission_rules_select ON collection_commission_rules
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY collection_commission_rules_insert ON collection_commission_rules
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY collection_commission_rules_update ON collection_commission_rules
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY collection_commission_rules_delete ON collection_commission_rules
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON collection_commission_rules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON collection_commission_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 7. Auditoría y permisos
-- ============================================================
DROP TRIGGER IF EXISTS audit_collection_actions ON collection_actions;
CREATE TRIGGER audit_collection_actions
  AFTER INSERT OR UPDATE OR DELETE ON collection_actions
  FOR EACH ROW EXECUTE FUNCTION audit_row();

DROP TRIGGER IF EXISTS audit_collection_promises ON collection_promises;
CREATE TRIGGER audit_collection_promises
  AFTER INSERT OR UPDATE OR DELETE ON collection_promises
  FOR EACH ROW EXECUTE FUNCTION audit_row();

DROP TRIGGER IF EXISTS audit_collection_policies ON collection_policies;
CREATE TRIGGER audit_collection_policies
  AFTER INSERT OR UPDATE OR DELETE ON collection_policies
  FOR EACH ROW EXECUTE FUNCTION audit_row();

DROP TRIGGER IF EXISTS audit_collection_commission_rules ON collection_commission_rules;
CREATE TRIGGER audit_collection_commission_rules
  AFTER INSERT OR UPDATE OR DELETE ON collection_commission_rules
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE, DELETE ON collection_outcomes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_actions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_promises TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_policies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_commission_rules TO authenticated;

GRANT ALL ON collection_outcomes TO service_role;
GRANT ALL ON collection_actions TO service_role;
GRANT ALL ON collection_promises TO service_role;
GRANT ALL ON collection_assignments TO service_role;
GRANT ALL ON collection_policies TO service_role;
GRANT ALL ON collection_commission_rules TO service_role;
