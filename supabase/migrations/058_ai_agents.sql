-- ============================================================
-- 058_ai_agents.sql — Agentes de IA del submenú Flujos.
--
-- Versión mínima funcional: nombre, descripción, estado y campos de
-- personalidad (objetivo, comportamiento, tono, reglas prohibidas).
-- El simulador consume la config de IA de la cuenta (ai_configs).
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_agents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name                text NOT NULL,
  description         text,
  status              text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  objective           text,
  behavior            text,
  tone                text[] NOT NULL DEFAULT '{}',
  prohibited_rules    text[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_account ON ai_agents(account_id);

ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agents_select ON ai_agents;
CREATE POLICY ai_agents_select ON ai_agents FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_agents_insert ON ai_agents;
CREATE POLICY ai_agents_insert ON ai_agents FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_agents_update ON ai_agents;
CREATE POLICY ai_agents_update ON ai_agents FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_agents_delete ON ai_agents;
CREATE POLICY ai_agents_delete ON ai_agents FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS update_ai_agents_updated_at ON ai_agents;
CREATE TRIGGER update_ai_agents_updated_at
  BEFORE UPDATE ON ai_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Bitácora de auditoría (migración 041).
DROP TRIGGER IF EXISTS audit_ai_agents ON ai_agents;
CREATE TRIGGER audit_ai_agents
  AFTER INSERT OR UPDATE OR DELETE ON ai_agents
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
