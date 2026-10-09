-- ============================================================
-- Migration: Translate existing database content to Spanish
-- Run this in your Supabase SQL editor
-- ============================================================

-- 1. Translate existing pipeline stage names
UPDATE pipeline_stages
SET name = CASE
  WHEN name = 'New Lead' THEN 'Nuevo Prospecto'
  WHEN name = 'Qualified' THEN 'Calificado'
  WHEN name = 'Proposal Sent' THEN 'Propuesta Enviada'
  WHEN name = 'Negotiation' THEN 'Negociación'
  WHEN name = 'Won' THEN 'Ganado'
  WHEN name = 'Lost' THEN 'Perdido'
END
WHERE name IN ('New Lead', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won', 'Lost');

-- 2. Translate existing pipeline names
UPDATE pipelines
SET name = 'Pipeline de Ventas'
WHERE name = 'Sales Pipeline';

-- 3. Update default pipeline name for new accounts
-- (This is handled in code now via SPEC_DEFAULT_STAGES)

-- 4. Create integrations table if it doesn't exist
CREATE TABLE IF NOT EXISTS integrations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slack_webhook_url TEXT,
  slack_enabled BOOLEAN DEFAULT FALSE,
  smtp_host TEXT,
  smtp_port TEXT,
  smtp_user TEXT,
  smtp_pass TEXT,
  smtp_from TEXT,
  email_enabled BOOLEAN DEFAULT FALSE,
  custom_webhook_url TEXT,
  custom_webhook_secret TEXT,
  custom_webhook_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(account_id)
);

-- Enable RLS on integrations
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

-- Allow account members to read their own integration config.
-- NOTE: este fork usa `is_account_member()` (017_account_sharing.sql),
-- NO la tabla `account_members` del wacrm original. Se usa DROP IF EXISTS
-- para que la migración sea re-ejecutable.
DROP POLICY IF EXISTS "Members can read own integration config" ON integrations;
CREATE POLICY "Members can read own integration config"
  ON integrations FOR SELECT
  USING (is_account_member(account_id));

-- Allow admins to upsert integration config
DROP POLICY IF EXISTS "Admins can upsert integration config" ON integrations;
CREATE POLICY "Admins can upsert integration config"
  ON integrations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "Admins can update integration config" ON integrations;
CREATE POLICY "Admins can update integration config"
  ON integrations FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "Admins can delete integration config" ON integrations;
CREATE POLICY "Admins can delete integration config"
  ON integrations FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- End of migration
-- ============================================================
