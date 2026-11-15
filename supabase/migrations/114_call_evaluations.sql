-- ============================================================
-- 114_call_evaluations.sql — QA de llamadas (WEM)
--
-- Un contact center no se mide solo por volumen: el supervisor
-- escucha/lee una llamada y la puntúa con una rúbrica. Esa nota es
-- la base del trabajo de calidad (WEM) y del feedback al agente.
--
-- Una evaluación por llamada (`UNIQUE call_id`). La rúbrica vive en
-- la app (`src/lib/telephony/qa.ts`), no en una tabla configurable:
-- igual que las disposiciones, es una lista fija y versionada.
--
--   criteria  — JSONB [{ key, label, score, max }]
--   score     — 0..100 calculado en el servidor
--   comments  — feedback escrito del evaluador
--
-- Solo admin+ evalúa. Cualquier miembro puede leer las notas.
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS call_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  -- Agente evaluado: se copia de la llamada para poder agregar sin
  -- depender de que la sesión siga existiendo.
  agent_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  evaluator_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (call_id)
);

CREATE INDEX IF NOT EXISTS idx_call_evaluations_account_created
  ON call_evaluations(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_evaluations_agent
  ON call_evaluations(account_id, agent_user_id, created_at DESC);

ALTER TABLE call_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_evaluations_select ON call_evaluations;
DROP POLICY IF EXISTS call_evaluations_insert ON call_evaluations;
DROP POLICY IF EXISTS call_evaluations_update ON call_evaluations;
DROP POLICY IF EXISTS call_evaluations_delete ON call_evaluations;

-- Viewer+ lee (el agente ve su propia nota); solo admin+ escribe.
CREATE POLICY call_evaluations_select ON call_evaluations
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY call_evaluations_insert ON call_evaluations
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY call_evaluations_update ON call_evaluations
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY call_evaluations_delete ON call_evaluations
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS call_evaluations_updated_at ON call_evaluations;
CREATE TRIGGER call_evaluations_updated_at
  BEFORE UPDATE ON call_evaluations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

NOTIFY pgrst, 'reload schema';
