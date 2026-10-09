-- ============================================================
-- 034_notes.sql — Notas internas (Notes)
--
-- Core CRM: notas internas del equipo, ligables a un Contacto,
-- Lead, Empresa y/o Oferta (o sueltas). Se distinguen de
-- `contact_notes` (notas por contacto del módulo de Contactos):
-- aquí el dueño es la cuenta y la nota puede apuntar a cualquier
-- entidad del CRM. Alimentan el Timeline.
--
-- Añade:
--   1. Tabla `notes` (cuenta-scoped, RLS por membresía).
--   2. Fixado (pinned) + vínculos polimórficos opcionales.
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Tenancy key — toda fila pertenece a una cuenta.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Autor de la nota (auth.users.id, = profiles.id).
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  -- Las notas fijadas se muestran primero.
  pinned BOOLEAN NOT NULL DEFAULT false,
  -- Vínculos opcionales: una nota puede referirse a varias entidades.
  -- Si se borra la entidad, la nota se elimina (CASCADE), igual que
  -- contact_notes.
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_account          ON notes(account_id);
CREATE INDEX IF NOT EXISTS idx_notes_pinned_created   ON notes(account_id, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_contact          ON notes(contact_id);
CREATE INDEX IF NOT EXISTS idx_notes_lead             ON notes(lead_id);
CREATE INDEX IF NOT EXISTS idx_notes_org              ON notes(organization_id);
CREATE INDEX IF NOT EXISTS idx_notes_deal             ON notes(deal_id);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- Idempotencia: CREATE POLICY no tiene IF NOT EXISTS → drop primero.
DROP POLICY IF EXISTS notes_select ON notes;
DROP POLICY IF EXISTS notes_insert ON notes;
DROP POLICY IF EXISTS notes_update ON notes;
DROP POLICY IF EXISTS notes_delete ON notes;

-- Viewer+ lee; agente+ crea/edita/borra (dato operativo, como contactos).
CREATE POLICY notes_select ON notes FOR SELECT USING (is_account_member(account_id));
CREATE POLICY notes_insert ON notes FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY notes_update ON notes FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY notes_delete ON notes FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON notes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
