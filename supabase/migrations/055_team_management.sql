-- ============================================================
-- 055_team_management.sql — Configuración → Gestión de equipos.
--
-- Piezas de datos que faltaban para el submenú «Gestión de equipos»:
--
--   1. `user_groups` + `user_group_members` — grupos de usuarios
--      (una colección con nombre de miembros de la cuenta). Sirven
--      para organizar agentes y como destino de las reglas de
--      asignación. No sustituyen a `teams` (que agrupan para los
--      reportes): un grupo es una lista guardada de usuarios.
--   2. `assignment_rules` — reglas de asignación automática por
--      canal/equipo/grupo con estrategia round-robin, menos
--      ocupado o usuario fijo. Se almacenan y se editan aquí; el
--      paso "asignar conversación" de las automatizaciones puede
--      consultarlas.
--   3. `close_reasons` — catálogo por cuenta de motivos de cierre
--      de conversación (antes hardcodeado). Se siembran los
--      motivos históricos en cada cuenta existente.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. GRUPOS DE USUARIOS
-- ============================================================
CREATE TABLE IF NOT EXISTS user_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Color de acento de la UI (clase/valor libre, p. ej. un hex).
  color TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_user_groups_account ON user_groups(account_id);

ALTER TABLE user_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_groups_select ON user_groups;
DROP POLICY IF EXISTS user_groups_insert ON user_groups;
DROP POLICY IF EXISTS user_groups_update ON user_groups;
DROP POLICY IF EXISTS user_groups_delete ON user_groups;

CREATE POLICY user_groups_select ON user_groups
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY user_groups_insert ON user_groups
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY user_groups_update ON user_groups
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY user_groups_delete ON user_groups
  FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON user_groups;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON user_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- user_group_members — una persona puede estar en varios grupos.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  -- Redundante con user_groups.account_id, pero simplifica las RLS.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_user_group_members_group ON user_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_user_group_members_profile ON user_group_members(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_group_members_account ON user_group_members(account_id);

ALTER TABLE user_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_group_members_select ON user_group_members;
DROP POLICY IF EXISTS user_group_members_insert ON user_group_members;
DROP POLICY IF EXISTS user_group_members_update ON user_group_members;
DROP POLICY IF EXISTS user_group_members_delete ON user_group_members;

CREATE POLICY user_group_members_select ON user_group_members
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY user_group_members_insert ON user_group_members
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY user_group_members_update ON user_group_members
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY user_group_members_delete ON user_group_members
  FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- 2. REGLAS DE ASIGNACIÓN
-- ============================================================
CREATE TABLE IF NOT EXISTS assignment_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Filtro de canal (NULL = cualquier canal).
  channel TEXT,
  -- Alcance: equipo y/o grupo (NULL = toda la cuenta).
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  group_id UUID REFERENCES user_groups(id) ON DELETE SET NULL,
  strategy TEXT NOT NULL DEFAULT 'round_robin'
    CHECK (strategy IN ('round_robin', 'least_busy', 'specific_user')),
  -- Solo para strategy = 'specific_user'.
  target_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Mayor prioridad = se evalúa antes.
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_rules_account
  ON assignment_rules(account_id, priority DESC);

ALTER TABLE assignment_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assignment_rules_select ON assignment_rules;
DROP POLICY IF EXISTS assignment_rules_insert ON assignment_rules;
DROP POLICY IF EXISTS assignment_rules_update ON assignment_rules;
DROP POLICY IF EXISTS assignment_rules_delete ON assignment_rules;

CREATE POLICY assignment_rules_select ON assignment_rules
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY assignment_rules_insert ON assignment_rules
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY assignment_rules_update ON assignment_rules
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY assignment_rules_delete ON assignment_rules
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON assignment_rules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON assignment_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. MOTIVOS DE CIERRE
-- ============================================================
CREATE TABLE IF NOT EXISTS close_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  -- Orden de presentación en la Bandeja.
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, label)
);

CREATE INDEX IF NOT EXISTS idx_close_reasons_account
  ON close_reasons(account_id, position);

ALTER TABLE close_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS close_reasons_select ON close_reasons;
DROP POLICY IF EXISTS close_reasons_insert ON close_reasons;
DROP POLICY IF EXISTS close_reasons_update ON close_reasons;
DROP POLICY IF EXISTS close_reasons_delete ON close_reasons;

CREATE POLICY close_reasons_select ON close_reasons
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY close_reasons_insert ON close_reasons
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY close_reasons_update ON close_reasons
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY close_reasons_delete ON close_reasons
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON close_reasons;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON close_reasons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 3b. Siembra de motivos por defecto en cada cuenta existente.
--     Solo cuando la cuenta aún no tiene ninguno (idempotente).
-- ------------------------------------------------------------
INSERT INTO close_reasons (account_id, label, position)
SELECT a.id, d.label, d.position
FROM accounts a
CROSS JOIN (
  VALUES
    ('Resuelto', 1),
    ('Sin respuesta del cliente', 2),
    ('Seguimiento pendiente', 3),
    ('Derivado a otra área', 4),
    ('Spam / no deseado', 5),
    ('Duplicado', 6)
) AS d(label, position)
WHERE NOT EXISTS (
  SELECT 1 FROM close_reasons cr WHERE cr.account_id = a.id
);

-- ============================================================
-- 4. Permisos de tabla (RLS gobierna fila por fila).
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON user_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_group_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON assignment_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON close_reasons TO authenticated;

GRANT ALL ON user_groups, user_group_members, assignment_rules, close_reasons TO service_role;
