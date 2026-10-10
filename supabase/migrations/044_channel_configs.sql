-- ============================================================
-- 044_channel_configs.sql — Canales omnicanal (Evolution API / Chatwoot)
--
-- Una fila por (cuenta, canal). `config` es jsonb libre con los datos
-- de conexión; los secretos (api_key / token) se guardan cifrados
-- (AES-256-GCM, igual que los tokens de WhatsApp) y nunca se devuelven
-- al cliente. `is_active` controla si el canal acepta tráfico.
--
--   evolution → { base_url, instance, api_key }   (WhatsApp no oficial)
--   chatwoot  → { base_url, account_id, api_token }
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('evolution', 'chatwoot')),
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_channel_configs_account ON channel_configs(account_id);

ALTER TABLE channel_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_configs_select ON channel_configs;
CREATE POLICY channel_configs_select ON channel_configs FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS channel_configs_insert ON channel_configs;
CREATE POLICY channel_configs_insert ON channel_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS channel_configs_update ON channel_configs;
CREATE POLICY channel_configs_update ON channel_configs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS channel_configs_delete ON channel_configs;
CREATE POLICY channel_configs_delete ON channel_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS update_channel_configs_updated_at ON channel_configs;
CREATE TRIGGER update_channel_configs_updated_at
  BEFORE UPDATE ON channel_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Bitácora de auditoría (migración 041). El trigger redacta campos
-- sensibles por nombre; `config` es jsonb y se registra tal cual (los
-- secretos ya van cifrados).
DROP TRIGGER IF EXISTS audit_channel_configs ON channel_configs;
CREATE TRIGGER audit_channel_configs
  AFTER INSERT OR UPDATE OR DELETE ON channel_configs
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
