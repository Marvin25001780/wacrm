-- ============================================================
-- 039_webchat.sql - Widget de webchat  ·  módulo 2.6
--
-- Configuración por cuenta para un widget público que captura
-- leads (source='webchat'). Un token público identifica la cuenta
-- y permite servir la configuración + recibir mensajes.
--
-- Crea:
--   1. webchat_configs — configuración del widget.
-- ============================================================

-- ============================================================
-- 1. webchat_configs
-- ============================================================
CREATE TABLE IF NOT EXISTS webchat_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  token UUID NOT NULL DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL DEFAULT 'Chatea con nosotros',
  welcome_message TEXT,
  color TEXT NOT NULL DEFAULT '#2563eb',
  button_text TEXT NOT NULL DEFAULT 'Enviar',
  position TEXT NOT NULL DEFAULT 'bottom-right'
    CHECK (position IN ('bottom-right', 'bottom-left')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webchat_configs_account_unique UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS idx_webchat_configs_account ON webchat_configs(account_id);
CREATE INDEX IF NOT EXISTS idx_webchat_configs_token ON webchat_configs(token);

ALTER TABLE webchat_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webchat_configs_select ON webchat_configs;
DROP POLICY IF EXISTS webchat_configs_insert ON webchat_configs;
DROP POLICY IF EXISTS webchat_configs_update ON webchat_configs;
DROP POLICY IF EXISTS webchat_configs_delete ON webchat_configs;

CREATE POLICY webchat_configs_select ON webchat_configs
  FOR SELECT USING (is_account_member(account_id));

CREATE POLICY webchat_configs_insert ON webchat_configs
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY webchat_configs_update ON webchat_configs
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

CREATE POLICY webchat_configs_delete ON webchat_configs
  FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON webchat_configs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON webchat_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
