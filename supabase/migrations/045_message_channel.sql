-- ============================================================
-- 045_message_channel.sql — Métricas de mensajería (multicanal)
--
-- El módulo de métricas agrega los mensajes por CANAL. Hasta ahora la
-- cuenta operaba solo WhatsApp (Meta Cloud API + Evolution) y el CRM
-- no registraba de qué canal provenía cada mensaje. Esta migración
-- añade `messages.channel` para que:
--
--   1. las métricas de enviados / recibidos / respondidos se puedan
--      desglosar por canal, y
--   2. cualquier integración (correo entrante, Instagram, TikTok,
--      webchat…) quede etiquetada sin volver a tocar el esquema.
--
-- El default `'whatsapp'` deja el histórico intacto y hace que todos
-- los INSERT actuales sigan funcionando sin cambios.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_channel_check'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_channel_check
      CHECK (channel IN (
        'whatsapp', 'instagram', 'facebook', 'tiktok',
        'telegram', 'email', 'webchat'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_channel_created_at
  ON messages (channel, created_at DESC);

COMMENT ON COLUMN messages.channel IS
  'Canal de origen del mensaje. whatsapp cubre Meta Cloud API y Evolution.';
