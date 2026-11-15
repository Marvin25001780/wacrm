-- ============================================================
-- 117_outbound_campaigns.sql — campañas salientes (preview v1)
--
-- Una campaña saliente agrupa contactos a los que el equipo de
-- agentes va a marcar por el softphone. V1 es "preview": el CRM no
-- hace fan-out automático; cada contacto se marca desde la campaña
-- con el flujo normal de llamadas (startCall → claim → answer →
-- disposition), y el vínculo queda en `outbound_campaign_contacts`.
--
-- Añade:
--   outbound_campaigns              — la campaña (nombre + auditoría).
--   outbound_campaign_contacts     — contacto ↔ campaña con estado
--                                    (pending / called) y su llamada.
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS outbound_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbound_campaign_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'called')),
  called_at TIMESTAMPTZ,
  call_session_id UUID REFERENCES call_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_outbound_campaign_contacts_campaign
  ON outbound_campaign_contacts(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_outbound_campaign_contacts_contact
  ON outbound_campaign_contacts(contact_id);

ALTER TABLE outbound_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_campaign_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbound_campaigns_select ON outbound_campaigns;
DROP POLICY IF EXISTS outbound_campaigns_insert ON outbound_campaigns;
DROP POLICY IF EXISTS outbound_campaigns_update ON outbound_campaigns;
DROP POLICY IF EXISTS outbound_campaigns_delete ON outbound_campaigns;

CREATE POLICY outbound_campaigns_select ON outbound_campaigns
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY outbound_campaigns_insert ON outbound_campaigns
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY outbound_campaigns_update ON outbound_campaigns
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY outbound_campaigns_delete ON outbound_campaigns
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS outbound_campaign_contacts_select ON outbound_campaign_contacts;
DROP POLICY IF EXISTS outbound_campaign_contacts_insert ON outbound_campaign_contacts;
DROP POLICY IF EXISTS outbound_campaign_contacts_update ON outbound_campaign_contacts;
DROP POLICY IF EXISTS outbound_campaign_contacts_delete ON outbound_campaign_contacts;

CREATE POLICY outbound_campaign_contacts_select ON outbound_campaign_contacts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM outbound_campaigns c
      WHERE c.id = outbound_campaign_contacts.campaign_id
        AND is_account_member(c.account_id)
    )
  );
CREATE POLICY outbound_campaign_contacts_insert ON outbound_campaign_contacts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM outbound_campaigns c
      WHERE c.id = outbound_campaign_contacts.campaign_id
        AND is_account_member(c.account_id, 'admin')
    )
  );
CREATE POLICY outbound_campaign_contacts_update ON outbound_campaign_contacts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM outbound_campaigns c
      WHERE c.id = outbound_campaign_contacts.campaign_id
        AND is_account_member(c.account_id, 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM outbound_campaigns c
      WHERE c.id = outbound_campaign_contacts.campaign_id
        AND is_account_member(c.account_id, 'admin')
    )
  );
CREATE POLICY outbound_campaign_contacts_delete ON outbound_campaign_contacts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM outbound_campaigns c
      WHERE c.id = outbound_campaign_contacts.campaign_id
        AND is_account_member(c.account_id, 'admin')
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'outbound_campaigns'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE outbound_campaigns;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
