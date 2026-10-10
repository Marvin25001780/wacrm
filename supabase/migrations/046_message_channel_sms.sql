-- ============================================================
-- 046_message_channel_sms.sql — añade el canal 'sms'
--
-- El widget de mensajería del Panel (estilo Kommo) desglosa los
-- mensajes por canal. WhatsApp ya escribe en `messages`; el SMS se
-- sumará en cuanto el módulo de SMS persista sus mensajes. Se amplía
-- el CHECK de `messages.channel` para incluir 'sms' y dejar el
-- catálogo alineado con el tipo TS `MessageChannel`.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_channel_check
  CHECK (channel IN (
    'whatsapp', 'sms', 'instagram', 'facebook', 'tiktok',
    'telegram', 'email', 'webchat'
  ));
