-- ============================================================
-- 041_audit_log.sql — Bitácora de auditoría empresarial
--
-- Append-only, account-scoped history of every change to the CRM's
-- business tables. Rather than instrument each client-side write (the
-- app writes to Supabase directly from the browser in many places), a
-- single generic trigger captures INSERT / UPDATE / DELETE on a curated
-- set of tables and records who did it.
--
-- Design
--   - `account_id` is derived from the row's own `account_id` column;
--     rows without one are ignored (the trigger returns early).
--   - `actor_id` / `actor_email` come from the request JWT via
--     `auth.uid()` / `auth.jwt()`. Service-role writes (webhooks) have
--     no JWT, so actor is NULL — still recorded.
--   - `changes` stores `{ before, after }` jsonb with sensitive columns
--     removed (API keys, tokens, passwords). Encrypted values are never
--     meant to leave the app anyway; redaction keeps the log clean.
--   - RLS: admin+ may read. Nothing may read it otherwise. Writes only
--     happen through the SECURITY DEFINER trigger (clients can't forge
--     entries).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor_id     uuid,
  actor_email  text,
  table_name   text NOT NULL,
  operation    text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id    uuid,
  changes      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_account_created
  ON audit_logs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_account_table
  ON audit_logs(account_id, table_name);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admin+ can read the audit trail.
DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- Generic audit trigger.
-- ============================================================
CREATE OR REPLACE FUNCTION public.audit_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before_row jsonb;
  after_row  jsonb;
  acct       uuid;
  rec        uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    before_row := to_jsonb(OLD);
  ELSIF (TG_OP = 'UPDATE') THEN
    before_row := to_jsonb(OLD);
    after_row  := to_jsonb(NEW);
  ELSE
    after_row := to_jsonb(NEW);
  END IF;

  -- Strip sensitive columns so they never reach the audit trail.
  IF before_row IS NOT NULL THEN
    before_row := before_row
      - 'api_key' - 'access_token' - 'secret' - 'smtp_pass'
      - 'webhook_secret' - 'custom_webhook_secret'
      - 'verify_token' - 'app_secret';
  END IF;
  IF after_row IS NOT NULL THEN
    after_row := after_row
      - 'api_key' - 'access_token' - 'secret' - 'smtp_pass'
      - 'webhook_secret' - 'custom_webhook_secret'
      - 'verify_token' - 'app_secret';
  END IF;

  acct := COALESCE((after_row ->> 'account_id')::uuid, (before_row ->> 'account_id')::uuid);
  rec  := COALESCE((after_row ->> 'id')::uuid, (before_row ->> 'id')::uuid);

  -- Tables without an account scope aren't audited.
  IF acct IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO audit_logs (
    account_id, actor_id, actor_email, table_name, operation, record_id, changes
  ) VALUES (
    acct,
    auth.uid(),
    auth.jwt() ->> 'email',
    TG_TABLE_NAME,
    TG_OP,
    rec,
    jsonb_strip_nulls(
      jsonb_build_object('before', before_row, 'after', after_row)
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================
-- Attach the trigger to the curated set of business tables.
-- ============================================================
DO $$
DECLARE
  t text;
  audited text[] := ARRAY[
    'leads', 'deals', 'contacts', 'organizations', 'activities',
    'notes', 'attachments', 'spaces', 'space_records',
    'receivables', 'receivable_payments', 'broadcasts',
    'account_invitations', 'api_keys', 'webhook_endpoints',
    'ai_configs', 'webchat_configs', 'sms_config', 'integrations',
    'whatsapp_config', 'pipelines', 'tags', 'custom_fields',
    'message_templates'
  ];
BEGIN
  FOREACH t IN ARRAY audited LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION public.audit_row()',
      t, t
    );
  END LOOP;
END;
$$;
