-- ============================================================
-- 032_leads.sql — Leads (prospectos)
--
-- Core CRM: entidad independiente de Contactos/Deals para
-- capturar prospectos antes de calificarlos. Un Lead puede
-- "convertirse": se crea (o reutiliza) un Contacto y,
-- opcionalmente, una Oferta (deal) en el pipeline.
--
-- Añade:
--   1. Tabla `leads` (cuenta-scoped, RLS por membresía).
--   2. Vínculos de conversión: converted_contact_id / converted_deal_id.
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Tenancy key — toda fila pertenece a una cuenta.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Autor original (auditoría). Nunca se usa para aislamiento.
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Agente responsable del lead (opcional). Igual que deals.assigned_to.
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  -- Empresa como texto libre (compatibilidad con Contactos)...
  company TEXT,
  -- ...y su vínculo normalizado a Empresas (organizations).
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  job_title TEXT,
  -- Origen del lead (mismos slugs que contacts.source).
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'qualified', 'unqualified', 'converted')),
  -- Producto / servicio de interés.
  interest TEXT,
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  notes TEXT,
  -- Resultado de la conversión (NULL hasta convertir).
  converted_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  converted_deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_account      ON leads(account_id);
CREATE INDEX IF NOT EXISTS idx_leads_status       ON leads(account_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to  ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_phone        ON leads(account_id, phone);
CREATE INDEX IF NOT EXISTS idx_leads_organization ON leads(organization_id);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Idempotencia: CREATE POLICY no tiene IF NOT EXISTS → drop primero.
DROP POLICY IF EXISTS leads_select ON leads;
DROP POLICY IF EXISTS leads_insert ON leads;
DROP POLICY IF EXISTS leads_update ON leads;
DROP POLICY IF EXISTS leads_delete ON leads;

-- Viewer+ lee; agente+ crea/edita/borra (dato operativo, como contactos).
CREATE POLICY leads_select ON leads FOR SELECT USING (is_account_member(account_id));
CREATE POLICY leads_insert ON leads FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY leads_update ON leads FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY leads_delete ON leads FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON leads;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
