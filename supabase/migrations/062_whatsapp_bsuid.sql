-- ============================================================
-- 062_whatsapp_bsuid
--
-- Port de la migración 040 del repo original.
-- Meta puede enviar mensajes sin número de teléfono, usando un
-- business-scoped user ID (BSUID). Estas columnas permiten
-- identificar y unificar contactos por ese ID.
--
-- phone en el CRM actual es nullable (migration 047), así que no
-- forzamos NOT NULL aquí.
-- Idempotente.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS wa_user_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_parent_user_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_username TEXT;

COMMENT ON COLUMN contacts.wa_user_id IS
  'WhatsApp business-scoped user ID. Primary inbound key when Meta withholds the phone number.';
COMMENT ON COLUMN contacts.wa_parent_user_id IS
  'Portfolio-level BSUID. Stored for reference; not used as lookup key.';
COMMENT ON COLUMN contacts.wa_username IS
  'WhatsApp username, without the leading @. Display only.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_wa_user_id
  ON contacts (account_id, wa_user_id)
  WHERE wa_user_id IS NOT NULL;
