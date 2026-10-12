-- ============================================================
-- 047_meta_channels.sql — conexión de canales de Meta
-- (Instagram Direct + Facebook Messenger) por token.
--
-- A diferencia de WhatsApp (QR de Evolution / Baileys), Instagram y
-- Facebook no admiten QR: se conectan con credenciales de Meta (token
-- de página + App Secret) y reciben los mensajes por un webhook de
-- Meta. Esta migración prepara el esquema:
--
--   1. `channel_configs.channel` admite 'instagram' y 'facebook'.
--   2. `conversations` gana `channel` (transporte del hilo) y
--      `external_contact_id` (PSID/IGSID: el id del usuario en la
--      plataforma, análogo al teléfono en WhatsApp).
--   3. `contacts.phone` pasa a ser NULLABLE: los remitentes de
--      Instagram/Facebook no tienen teléfono. El índice único
--      (account_id, phone_normalized) de la migración 022 excluye los
--      NULL (`WHERE phone_normalized <> ''`), así que no colisionan.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- 1) channel_configs: habilitar los canales de Meta.
ALTER TABLE channel_configs DROP CONSTRAINT IF EXISTS channel_configs_channel_check;
ALTER TABLE channel_configs
  ADD CONSTRAINT channel_configs_channel_check
  CHECK (channel IN ('evolution', 'chatwoot', 'instagram', 'facebook'));

-- 2) conversations: transporte del hilo + id externo del contacto.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS external_contact_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_channel_check'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_channel_check
      CHECK (channel IN (
        'whatsapp', 'sms', 'instagram', 'facebook', 'tiktok',
        'telegram', 'email', 'webchat'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_channel_external
  ON conversations (account_id, channel, external_contact_id);

-- 3) contacts.phone nullable (remitentes sin teléfono).
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

COMMENT ON COLUMN conversations.channel IS
  'Transporte del hilo: whatsapp/sms/instagram/facebook/...';
COMMENT ON COLUMN conversations.external_contact_id IS
  'Id del contacto en su plataforma (PSID de Messenger / IGSID de Instagram).';
