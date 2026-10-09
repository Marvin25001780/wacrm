-- ============================================================
-- 031_organizations.sql — Empresas (Organizations)
--
-- Core CRM: relación Contacto → Empresa + origen del contacto.
--
-- Añade:
--   1. Tabla `organizations` (cuenta-scoped, RLS por membresía).
--   2. `contacts.organization_id`  → vínculo al empresa.
--   3. `contacts.source`           → origen del contacto (lead source).
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Tenancy key — toda fila pertenece a una cuenta.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Autor original (auditoría). Nunca se usa para aislamiento.
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Agente responsable de la cuenta/empresa (opcional).
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  industry TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  country TEXT DEFAULT 'Venezuela',
  -- RIF / identificación fiscal.
  tax_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_account ON organizations(account_id);
CREATE INDEX IF NOT EXISTS idx_organizations_name    ON organizations(account_id, name);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Idempotencia: CREATE POLICY no tiene IF NOT EXISTS → drop primero.
DROP POLICY IF EXISTS organizations_select ON organizations;
DROP POLICY IF EXISTS organizations_insert ON organizations;
DROP POLICY IF EXISTS organizations_update ON organizations;
DROP POLICY IF EXISTS organizations_delete ON organizations;

-- Viewer+ lee; agente+ crea/edita/borra (dato operativo, como contactos).
CREATE POLICY organizations_select ON organizations FOR SELECT USING (is_account_member(account_id));
CREATE POLICY organizations_insert ON organizations FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY organizations_update ON organizations FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY organizations_delete ON organizations FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON organizations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CONTACTS: vínculo a empresa + origen
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_organization ON contacts(organization_id);
