-- ============================================================
-- 132_external_integrations.sql — integraciones externas por cuenta
--
-- Tres servicios autoalojados que se consumen **por API o por SDK**,
-- sin copiar su código:
--
--   * OpenReplay (AGPL-3.0, tracker MIT) — grabación de sesiones del
--     CRM. Se carga el tracker oficial solo si la cuenta lo activa.
--   * Listmonk (AGPL-3.0) — boletines y listas de correo. El CRM
--     suscribe contactos con email por la API.
--   * VoiceSummary (MIT) — analítica de transcripciones de llamadas.
--     El CRM empuja la transcripción al terminar (o a pedido).
--
-- Reglas:
--   * Una fila por cuenta. Los tokens se guardan cifrados
--     (AES-256-GCM, igual que WhatsApp/IA/Mailflare) y la API nunca
--     los devuelve al navegador.
--   * Solo admin/owner lee y escribe esta tabla. La configuración
--     pública de OpenReplay (URL + project key, que ya viaja en el
--     navegador por diseño del tracker) se sirve por una ruta que
--     valida la sesión con service role.
--   * Todo es opcional: sin fila o con `*_enabled = false` el CRM no
--     llama a ningún servicio externo.
--
-- Idempotente. Requiere 017/066 (accounts, is_account_member).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.external_integrations (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,

  openreplay_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  openreplay_url TEXT,
  openreplay_project_key TEXT,

  listmonk_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  listmonk_url TEXT,
  listmonk_user TEXT,
  listmonk_token TEXT,
  listmonk_list_id BIGINT,

  voicesummary_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  voicesummary_url TEXT,
  voicesummary_token TEXT,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT external_integrations_openreplay_url
    CHECK (openreplay_url IS NULL OR openreplay_url ~ '^https?://'),
  CONSTRAINT external_integrations_listmonk_url
    CHECK (listmonk_url IS NULL OR listmonk_url ~ '^https?://'),
  CONSTRAINT external_integrations_voicesummary_url
    CHECK (voicesummary_url IS NULL OR voicesummary_url ~ '^https?://')
);

ALTER TABLE public.external_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS external_integrations_select ON public.external_integrations;
DROP POLICY IF EXISTS external_integrations_insert ON public.external_integrations;
DROP POLICY IF EXISTS external_integrations_update ON public.external_integrations;
DROP POLICY IF EXISTS external_integrations_delete ON public.external_integrations;

-- Solo admin/owner: la fila contiene tokens cifrados y configuración
-- que no debe ver un agente.
CREATE POLICY external_integrations_select ON public.external_integrations
  FOR SELECT USING (is_account_member(account_id, 'admin'));
CREATE POLICY external_integrations_insert ON public.external_integrations
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY external_integrations_update ON public.external_integrations
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY external_integrations_delete ON public.external_integrations
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS update_external_integrations_updated_at
  ON public.external_integrations;
CREATE TRIGGER update_external_integrations_updated_at
  BEFORE UPDATE ON public.external_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.external_integrations
TO authenticated;

NOTIFY pgrst, 'reload schema';
