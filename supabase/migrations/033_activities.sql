-- ============================================================
-- 033_activities.sql — Actividades (Activities)
--
-- Core CRM: interacciones/tareas programadas (llamada, reunión,
-- tarea, correo, WhatsApp, visita) vinculables a un Contacto,
-- Lead, Empresa y/o Oferta. Alimenta la Agenda y el Timeline.
--
-- Añade:
--   1. Tabla `activities` (cuenta-scoped, RLS por membresía).
--   2. Vínculos polimórficos opcionales a las entidades del CRM.
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Tenancy key — toda fila pertenece a una cuenta.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Autor original (auditoría). Nunca se usa para aislamiento.
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Agente responsable (profiles.id).
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'task'
    CHECK (type IN ('call', 'meeting', 'task', 'email', 'whatsapp', 'visit', 'other')),
  subject TEXT NOT NULL,
  description TEXT,
  -- Fecha/hora programada (opcional para tareas sin fecha).
  due_at TIMESTAMPTZ,
  -- Duración estimada en minutos (reuniones/llamadas).
  duration_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  -- Resultado / desenlace al completar la actividad.
  outcome TEXT,
  completed_at TIMESTAMPTZ,
  -- Vínculos opcionales (se preservan si se borra la entidad).
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_account     ON activities(account_id);
CREATE INDEX IF NOT EXISTS idx_activities_status      ON activities(account_id, status);
CREATE INDEX IF NOT EXISTS idx_activities_due         ON activities(account_id, due_at);
CREATE INDEX IF NOT EXISTS idx_activities_assigned_to ON activities(assigned_to);
CREATE INDEX IF NOT EXISTS idx_activities_contact     ON activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_lead        ON activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_org         ON activities(organization_id);
CREATE INDEX IF NOT EXISTS idx_activities_deal        ON activities(deal_id);

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Idempotencia: CREATE POLICY no tiene IF NOT EXISTS → drop primero.
DROP POLICY IF EXISTS activities_select ON activities;
DROP POLICY IF EXISTS activities_insert ON activities;
DROP POLICY IF EXISTS activities_update ON activities;
DROP POLICY IF EXISTS activities_delete ON activities;

-- Viewer+ lee; agente+ crea/edita/borra (dato operativo, como contactos).
CREATE POLICY activities_select ON activities FOR SELECT USING (is_account_member(account_id));
CREATE POLICY activities_insert ON activities FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY activities_update ON activities FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY activities_delete ON activities FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON activities;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
