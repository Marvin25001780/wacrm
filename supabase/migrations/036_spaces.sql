-- ============================================================
-- 036_spaces.sql — Espacios de trabajo (Spaces)  ·  módulo 2.1
--
-- Un "Espacio" es una agrupación colaborativa dentro de una
-- cuenta: tiene nombre, color, una descripción opcional, un
-- conjunto de MIEMBROS (usuarios de la cuenta) y un conjunto de
-- REGISTROS vinculados (contactos / leads / empresas / ofertas).
--
-- Alcance: los espacios son a nivel de CUENTA. Cualquier miembro
-- de la cuenta los ve (igual que el resto de módulos); la lista de
-- miembros es informativa (a quién pertenece el espacio), no un
-- control de acceso por espacio.
--
-- Crea:
--   1. `spaces`        — el espacio.
--   2. `space_members` — miembros (N:M espacios↔usuarios).
--   3. `space_records` — registros vinculados (polimórfico).
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- 1. spaces
-- ============================================================
CREATE TABLE IF NOT EXISTS spaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Tenancy key — NOT NULL.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Token de color de la paleta (se resuelve en el cliente).
  color TEXT NOT NULL DEFAULT 'primary',
  -- Autor original (auth.users.id = profiles.user_id).
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spaces_account ON spaces(account_id);
CREATE INDEX IF NOT EXISTS idx_spaces_created ON spaces(account_id, created_at DESC);

ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spaces_select ON spaces;
DROP POLICY IF EXISTS spaces_insert ON spaces;
DROP POLICY IF EXISTS spaces_update ON spaces;
DROP POLICY IF EXISTS spaces_delete ON spaces;

CREATE POLICY spaces_select ON spaces FOR SELECT USING (is_account_member(account_id));
CREATE POLICY spaces_insert ON spaces FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY spaces_update ON spaces FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY spaces_delete ON spaces FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON spaces;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON spaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. space_members — miembros del espacio (N:M)
-- ============================================================
CREATE TABLE IF NOT EXISTS space_members (
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  -- Redundante con spaces.account_id, pero simplifica las políticas RLS.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (space_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_space_members_space ON space_members(space_id);
CREATE INDEX IF NOT EXISTS idx_space_members_account ON space_members(account_id, user_id);

ALTER TABLE space_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS space_members_select ON space_members;
DROP POLICY IF EXISTS space_members_insert ON space_members;
DROP POLICY IF EXISTS space_members_update ON space_members;
DROP POLICY IF EXISTS space_members_delete ON space_members;

CREATE POLICY space_members_select ON space_members FOR SELECT USING (is_account_member(account_id));
CREATE POLICY space_members_insert ON space_members FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY space_members_update ON space_members FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY space_members_delete ON space_members FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- 3. space_records — registros vinculados (polimórfico)
-- ============================================================
CREATE TABLE IF NOT EXISTS space_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'lead', 'organization', 'deal')),
  -- Sin FK (polimórfico); la integridad la garantiza la app.
  entity_id UUID NOT NULL,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (space_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_space_records_space ON space_records(space_id);
CREATE INDEX IF NOT EXISTS idx_space_records_account ON space_records(account_id);
CREATE INDEX IF NOT EXISTS idx_space_records_entity ON space_records(entity_type, entity_id);

ALTER TABLE space_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS space_records_select ON space_records;
DROP POLICY IF EXISTS space_records_insert ON space_records;
DROP POLICY IF EXISTS space_records_update ON space_records;
DROP POLICY IF EXISTS space_records_delete ON space_records;

CREATE POLICY space_records_select ON space_records FOR SELECT USING (is_account_member(account_id));
CREATE POLICY space_records_insert ON space_records FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY space_records_update ON space_records FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY space_records_delete ON space_records FOR DELETE USING (is_account_member(account_id, 'agent'));
