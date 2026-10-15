-- ============================================================
-- 057_bots.sql — Bots del submenú Flujos.
--
-- Versión mínima funcional: nombre, estado, canal asociado,
-- versión y autor. Cada guardado incrementa la versión.
-- ============================================================

CREATE TABLE IF NOT EXISTS bots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name                text NOT NULL,
  status              text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  channel_id          uuid REFERENCES channel_configs(id) ON DELETE SET NULL,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bots_account ON bots(account_id);

ALTER TABLE bots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bots_select ON bots;
CREATE POLICY bots_select ON bots FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS bots_insert ON bots;
CREATE POLICY bots_insert ON bots FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS bots_update ON bots;
CREATE POLICY bots_update ON bots FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS bots_delete ON bots;
CREATE POLICY bots_delete ON bots FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS update_bots_updated_at ON bots;
CREATE TRIGGER update_bots_updated_at
  BEFORE UPDATE ON bots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Bitácora de auditoría (migración 041).
DROP TRIGGER IF EXISTS audit_bots ON bots;
CREATE TRIGGER audit_bots
  AFTER INSERT OR UPDATE OR DELETE ON bots
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
