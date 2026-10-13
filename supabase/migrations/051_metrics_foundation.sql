-- ============================================================
-- 051_metrics_foundation.sql — Base del módulo de Métricas.
--
-- Piezas de datos que faltaban para construir los reportes:
--
--   1. `teams` + `team_members` — el concepto de EQUIPO (agrupar
--      agentes) que hoy no existía. Los reportes filtran/agrupan por
--      equipo y el agente se asigna a uno o varios equipos.
--   2. `conversation_tags` — etiquetas de CONVERSACIÓN (hoy las
--      etiquetas eran solo de contacto). Reutiliza el catálogo `tags`
--      para no duplicar nombres/colores.
--   3. `conversations.close_reason` + `conversations.closed_at` —
--      motivo de cierre y momento del cierre, para "motivos de cierre"
--      y "tiempo de cierre". `closed_at` se mantiene con un trigger a
--      partir del cambio de `status` a 'closed'.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. EQUIPOS
-- ============================================================
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Color de acento de la UI (clase/valor libre, p. ej. un hex).
  color TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_account ON teams(account_id);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS teams_select ON teams;
DROP POLICY IF EXISTS teams_insert ON teams;
DROP POLICY IF EXISTS teams_update ON teams;
DROP POLICY IF EXISTS teams_delete ON teams;

CREATE POLICY teams_select ON teams
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY teams_insert ON teams
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY teams_update ON teams
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY teams_delete ON teams
  FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON teams;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- team_members — un agente (perfil) puede estar en varios equipos.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- Redundante con teams.account_id, pero simplifica las políticas RLS.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_profile ON team_members(profile_id);
CREATE INDEX IF NOT EXISTS idx_team_members_account ON team_members(account_id);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_members_select ON team_members;
DROP POLICY IF EXISTS team_members_insert ON team_members;
DROP POLICY IF EXISTS team_members_update ON team_members;
DROP POLICY IF EXISTS team_members_delete ON team_members;

CREATE POLICY team_members_select ON team_members
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY team_members_insert ON team_members
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY team_members_update ON team_members
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY team_members_delete ON team_members
  FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- 2. ETIQUETAS DE CONVERSACIÓN
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  -- Redundante, para RLS sencillo.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_tags_conversation ON conversation_tags(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_tags_tag ON conversation_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_conversation_tags_account ON conversation_tags(account_id);

ALTER TABLE conversation_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_tags_select ON conversation_tags;
DROP POLICY IF EXISTS conversation_tags_insert ON conversation_tags;
DROP POLICY IF EXISTS conversation_tags_update ON conversation_tags;
DROP POLICY IF EXISTS conversation_tags_delete ON conversation_tags;

CREATE POLICY conversation_tags_select ON conversation_tags
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY conversation_tags_insert ON conversation_tags
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY conversation_tags_update ON conversation_tags
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY conversation_tags_delete ON conversation_tags
  FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- 2b. Etiquetas: permitir que el catálogo `tags` sea account-scoped
--     sin depender de `user_id` (algunas filas antiguas podrían
--     tener user_id NULL). No se cambia la estructura existente.
-- ============================================================

-- ============================================================
-- 3. conversations: motivo y momento de cierre
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS close_reason TEXT;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_closed_at
  ON conversations(account_id, closed_at);

-- Mantiene `closed_at` al cambiar el estado. Al reabrir un hilo se
-- limpia para que las métricas de "tiempo de cierre" no cuenten un
-- cierre que ya no existe.
CREATE OR REPLACE FUNCTION conversations_track_closed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'closed' AND (OLD.status IS DISTINCT FROM 'closed') THEN
    NEW.closed_at := COALESCE(NEW.closed_at, NOW());
  ELSIF NEW.status <> 'closed' THEN
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS track_closed_at ON conversations;
CREATE TRIGGER track_closed_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversations_track_closed_at();

-- Backfill conservador: los hilos ya cerrados sin fecha heredan su
-- última actividad como aproximación del cierre.
UPDATE conversations
  SET closed_at = COALESCE(closed_at, updated_at, created_at)
  WHERE status = 'closed' AND closed_at IS NULL;

-- ============================================================
-- 4. Permisos de tabla
--
-- Este proyecto no hereda los "default privileges" de Supabase en
-- las tablas creadas por migración, así que otorgamos los permisos
-- explícitamente. RLS sigue gobernando FILA por FILA el acceso:
-- estos GRANT solo habilitan que los roles puedan tocar la tabla.
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON teams TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_tags TO authenticated;

GRANT ALL ON teams, team_members, conversation_tags TO service_role;
