-- ============================================================
-- 071_ai_agent_channels.sql — canales donde responde cada agente
--
-- El agente deja de ser “un agente por cuenta” y pasa a declarar en
-- qué canales debe contestar. En esta versión los canales son los
-- cuatro con envío conversacional real:
--
--   whatsapp · sms · instagram · facebook
--
-- `channels` arranca en `{whatsapp}` para que las filas existentes
-- (Sofía incluida) conserven exactamente el comportamiento actual.
-- No hay backfill de mensajes: el motor solo responderá mensajes
-- entrantes posteriores a la activación.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT ARRAY['whatsapp']::text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_agents_channels_check'
      AND conrelid = 'public.ai_agents'::regclass
  ) THEN
    ALTER TABLE public.ai_agents
      ADD CONSTRAINT ai_agents_channels_check
      CHECK (
        cardinality(channels) > 0
        AND channels <@ ARRAY['whatsapp', 'sms', 'instagram', 'facebook']::text[]
      );
  END IF;
END
$$;

-- PostgREST cachea el esquema; sin esto la nueva columna tarda en
-- aparecer para el cliente que acaba de leer la tabla.
NOTIFY pgrst, 'reload schema';
