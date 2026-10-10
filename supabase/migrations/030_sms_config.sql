-- ============================================================
-- 030_sms_config.sql — secure, account-scoped SMS (textbee) config
--
-- The original fork shipped the SMS module with the textbee device id
-- and API key stored in the browser's `localStorage` and sent back to
-- the server on every request. That means:
--   * the secret is readable by any XSS on the dashboard,
--   * it leaks through browser sync / shared machines,
--   * and the server blindly trusts client-supplied credentials.
--
-- This migration introduces an account-scoped `sms_config` table that
-- mirrors `whatsapp_config` / `ai_configs`, so the credentials live
-- encrypted at rest (AES-256-GCM via ENCRYPTION_KEY) and are only ever
-- decrypted server-side.
--
-- Design notes
--   - One row per account, UNIQUE(account_id) — teammates share one
--     textbee device, exactly like the WhatsApp number.
--   - `api_key` is AES-256-GCM-encrypted and never returned to the
--     client after save.
--   - `created_by` records who saved it (audit); ON DELETE SET NULL so
--     removing a teammate doesn't drop the account's config.
--
-- RLS
--   Settings-class, mirroring `ai_configs`: any member (viewer+) may
--   read the row so the SMS page can show whether it's configured, but
--   only admin+ may create / update / delete it.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS sms_config (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  device_id   text NOT NULL,
  api_key     text NOT NULL,            -- AES-256-GCM-encrypted textbee API key
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sms_config ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) can see whether SMS is
-- configured (device id + a has-key flag), but never the key itself.
DROP POLICY IF EXISTS sms_config_select ON sms_config;
CREATE POLICY sms_config_select ON sms_config FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (settings-class).
DROP POLICY IF EXISTS sms_config_insert ON sms_config;
CREATE POLICY sms_config_insert ON sms_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sms_config_update ON sms_config;
CREATE POLICY sms_config_update ON sms_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sms_config_delete ON sms_config;
CREATE POLICY sms_config_delete ON sms_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Keep updated_at fresh on every write.
CREATE OR REPLACE FUNCTION public.update_sms_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sms_config_updated_at ON sms_config;
CREATE TRIGGER sms_config_updated_at
  BEFORE UPDATE ON sms_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sms_config_updated_at();
