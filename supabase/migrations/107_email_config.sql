-- ============================================================
-- 107_email_config.sql — Conexión del correo (Mailflare) por cuenta
--
-- * Una fila por cuenta: URL base del servidor Mailflare, API key
--   cifrada (AES-256-GCM, igual que WhatsApp/IA), datos del remitente
--   y buzón por defecto.
-- * La API key NUNCA se devuelve al navegador: la escritura pasa por
--   /api/email/settings y se cifra en el servidor. La columna sólo la
--   leen las rutas de API con la sesión del usuario.
-- * El módulo es opcional: si no hay fila o `enabled = false`, el
--   módulo Correo muestra la pantalla de configuración.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL,
  api_key TEXT,
  from_name TEXT,
  from_address TEXT,
  mailbox_id TEXT,
  signature TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_config_base_url_https CHECK (base_url ~ '^https://')
);

ALTER TABLE email_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_config_select ON email_config;
DROP POLICY IF EXISTS email_config_insert ON email_config;
DROP POLICY IF EXISTS email_config_update ON email_config;
DROP POLICY IF EXISTS email_config_delete ON email_config;

-- Cualquier miembro puede comprobar si la cuenta tiene correo
-- conectado (la UI lo usa para decidir qué pantalla mostrar).
CREATE POLICY email_config_select ON email_config
  FOR SELECT USING (is_account_member(account_id));

-- Sólo admin/owner puede conectar, cambiar credenciales o desconectar.
CREATE POLICY email_config_insert ON email_config
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY email_config_update ON email_config
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY email_config_delete ON email_config
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS update_email_config_updated_at ON email_config;
CREATE TRIGGER update_email_config_updated_at
  BEFORE UPDATE ON email_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_config
TO authenticated;

NOTIFY pgrst, 'reload schema';
