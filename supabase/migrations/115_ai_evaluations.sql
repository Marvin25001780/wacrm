-- ============================================================
-- 115_ai_evaluations.sql — QA automática con IA (WEM + IA)
--
-- El supervisor puede evaluar una llamada con la rúbrica fija
-- (114). Esta tabla guarda además una segunda opinión generada por
-- el proveedor de IA del negocio a partir de la transcripción, para
-- comparar humano vs. máquina y detectar llamadas sin evaluar.
--
-- Es una tabla aparte de `call_evaluations` porque:
--   - puede existir sin evaluación humana;
--   - no compite con el UNIQUE(call_id) del humano;
--   - se puede borrar/regenerar sin tocar la nota del supervisor.
--
-- El puntaje y los criterios se calculan/validan en el servidor con
-- `src/lib/telephony/qa.ts`; nunca se confía en el JSON del modelo.
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS call_ai_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  call_id UUID NOT NULL UNIQUE REFERENCES call_sessions(id) ON DELETE CASCADE,
  agent_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider TEXT,
  model TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_ai_evaluations_account_created
  ON call_ai_evaluations(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_ai_evaluations_agent
  ON call_ai_evaluations(account_id, agent_user_id, created_at DESC);

ALTER TABLE call_ai_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_ai_evaluations_select ON call_ai_evaluations;
DROP POLICY IF EXISTS call_ai_evaluations_insert ON call_ai_evaluations;
DROP POLICY IF EXISTS call_ai_evaluations_update ON call_ai_evaluations;
DROP POLICY IF EXISTS call_ai_evaluations_delete ON call_ai_evaluations;

CREATE POLICY call_ai_evaluations_select ON call_ai_evaluations
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY call_ai_evaluations_insert ON call_ai_evaluations
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY call_ai_evaluations_update ON call_ai_evaluations
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY call_ai_evaluations_delete ON call_ai_evaluations
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS call_ai_evaluations_updated_at ON call_ai_evaluations;
CREATE TRIGGER call_ai_evaluations_updated_at
  BEFORE UPDATE ON call_ai_evaluations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

NOTIFY pgrst, 'reload schema';
