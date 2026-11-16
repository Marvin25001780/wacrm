-- ============================================================
-- 119_agent_skills.sql — habilidades del agente y desbordamiento
--
-- ACD v2 sobre la cola de la 116/118: una entrante puede exigir
-- habilidades (por ejemplo "ventas" o "soporte técnico") y solo se
-- ofrece a los agentes que las tengan. Si nadie con esas habilidades
-- la toma en N segundos, el requisito se levanta y la llamada pasa a
-- cualquier agente disponible (desbordamiento por habilidad).
--
-- Añade:
--   1. `account_members.agent_skills` — habilidades de cada persona
--      EN ESTE negocio (mismo criterio que el alias de la 110).
--   2. `telephony_config.required_skills` — lo que exige la cola
--      entrante de este negocio.
--   3. `telephony_config.skill_overflow_seconds` — segundos antes de
--      levantar el requisito (0 = sin desbordamiento).
--   4. `call_sessions.required_skills` — copia del requisito al
--      entrar la llamada (cambiarlo después no altera la cola) y
--      `overflowed_at` — cuándo se levantó el requisito.
--   5. RPC `set_member_agent_skills` — escribe las habilidades con
--      SECURITY DEFINER (`account_members` solo tiene policy de
--      SELECT propio desde 066).
--   6. `account_member_roster()` de nuevo, con `agent_skills`.
--
-- Reglas de edición de habilidades
--   * Admin+ del negocio.
--   * El dueño puede cambiarlas a cualquiera.
--   * Un admin solo a agentes y espectadores (nunca al dueño ni a
--     otro admin), igual que el alias y los permisos del POS.
--
-- Requiere 066, 106, 110, 112, 116 y 118. Idempotente.
-- ============================================================

-- ============================================================
-- 1. Habilidades en la pertenencia
-- ============================================================

ALTER TABLE public.account_members
  ADD COLUMN IF NOT EXISTS agent_skills TEXT[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.account_members.agent_skills IS
  'Habilidades del agente en ESTE negocio (minúsculas, máx. 8). Vacío = sin habilidades: solo recibe llamadas sin requisito o desbordadas.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.account_members'::regclass
       AND conname = 'account_members_agent_skills_max'
  ) THEN
    ALTER TABLE public.account_members
      ADD CONSTRAINT account_members_agent_skills_max
      CHECK (cardinality(agent_skills) <= 8);
  END IF;
END $$;

-- ============================================================
-- 2. Requisito de la cola y desbordamiento
-- ============================================================

ALTER TABLE public.telephony_config
  ADD COLUMN IF NOT EXISTS required_skills TEXT[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.telephony_config
  ADD COLUMN IF NOT EXISTS skill_overflow_seconds INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.telephony_config'::regclass
       AND conname = 'telephony_config_required_skills_max'
  ) THEN
    ALTER TABLE public.telephony_config
      ADD CONSTRAINT telephony_config_required_skills_max
      CHECK (cardinality(required_skills) <= 8);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.telephony_config'::regclass
       AND conname = 'telephony_config_skill_overflow_range'
  ) THEN
    ALTER TABLE public.telephony_config
      ADD CONSTRAINT telephony_config_skill_overflow_range
      CHECK (skill_overflow_seconds >= 0 AND skill_overflow_seconds <= 3600);
  END IF;
END $$;

COMMENT ON COLUMN public.telephony_config.required_skills IS
  'Habilidades que debe tener un agente para que se le ofrezcan las entrantes. Vacío = sin requisito (entra cualquiera).';
COMMENT ON COLUMN public.telephony_config.skill_overflow_seconds IS
  'Segundos sin que nadie con las habilidades tome la llamada antes de levantar el requisito. 0 = sin desbordamiento.';

-- ============================================================
-- 3. Copia del requisito en la llamada
-- ============================================================

ALTER TABLE public.call_sessions
  ADD COLUMN IF NOT EXISTS required_skills TEXT[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.call_sessions
  ADD COLUMN IF NOT EXISTS overflowed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.call_sessions.required_skills IS
  'Requisito de habilidad copiado de telephony_config al entrar la llamada. Se copia para que cambiarlo después no altere una cola en curso.';
COMMENT ON COLUMN public.call_sessions.overflowed_at IS
  'Momento en que el requisito de habilidad se levantó (desbordamiento). NULL = sigue exigiendo las habilidades.';

CREATE INDEX IF NOT EXISTS idx_call_sessions_queue_skills
  ON public.call_sessions(account_id, status, started_at)
  WHERE direction = 'inbound' AND agent_user_id IS NULL;

-- ============================================================
-- 4. RPC de habilidades
--
-- Devuelve la lista guardada ya normalizada (minúsculas, sin
-- duplicados, sin vacíos). El cliente no escribe la tabla: la
-- pertenencia solo tiene policy de SELECT propio.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_member_agent_skills(
  p_user_id UUID,
  p_skills TEXT[]
)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_account UUID;
  v_actor_role TEXT;
  v_target_role TEXT;
  v_clean TEXT[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario' USING ERRCODE = '22023';
  END IF;

  -- Cuenta activa + rol real del que llama (no `profiles.account_role`,
  -- que solo vale si esa cuenta es su activa).
  SELECT p.account_id, m.role::text
    INTO v_account, v_actor_role
    FROM profiles p
    JOIN account_members m
      ON m.user_id = p.user_id
     AND m.account_id = p.account_id
   WHERE p.user_id = v_actor
   LIMIT 1;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Sin negocio activo' USING ERRCODE = '42501';
  END IF;

  SELECT m.role::text INTO v_target_role
    FROM account_members m
   WHERE m.user_id = p_user_id
     AND m.account_id = v_account
   LIMIT 1;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'El usuario no pertenece al negocio' USING ERRCODE = '22023';
  END IF;

  IF v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  -- Solo el dueño toca las habilidades de un admin o del dueño.
  IF v_actor_role <> 'owner' AND v_target_role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Solo el dueño puede cambiar las habilidades de un administrador'
      USING ERRCODE = '42501';
  END IF;

  -- Normaliza: recorta, minúsculas, descarta vacíos y duplicados.
  SELECT COALESCE(array_agg(skill ORDER BY first_ord), '{}'::text[])
    INTO v_clean
    FROM (
      SELECT lower(btrim(item)) AS skill, MIN(ord) AS first_ord
        FROM unnest(COALESCE(p_skills, '{}'::text[]))
             WITH ORDINALITY AS t(item, ord)
       WHERE btrim(item) <> ''
       GROUP BY 1
    ) normalized;

  IF cardinality(v_clean) > 8 THEN
    RAISE EXCEPTION 'Máximo 8 habilidades por agente' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_clean) AS s WHERE char_length(s) > 30
  ) THEN
    RAISE EXCEPTION 'Cada habilidad admite hasta 30 caracteres'
      USING ERRCODE = '22023';
  END IF;

  UPDATE account_members
     SET agent_skills = v_clean
   WHERE user_id = p_user_id
     AND account_id = v_account;

  RETURN v_clean;
END;
$$;

ALTER FUNCTION public.set_member_agent_skills(UUID, TEXT[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_agent_skills(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_agent_skills(UUID, TEXT[]) TO authenticated;

-- ============================================================
-- 5. Roster con habilidades
--
-- `CREATE OR REPLACE` no puede cambiar el tipo de retorno, así que se
-- suelta la firma de la 110 antes de recrearla.
-- ============================================================

DROP FUNCTION IF EXISTS public.account_member_roster();

CREATE FUNCTION public.account_member_roster()
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  display_name TEXT,
  email TEXT,
  avatar_url TEXT,
  role account_role_enum,
  joined_at TIMESTAMPTZ,
  agent_skills TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_role account_role_enum;
  v_can_see_email BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT m.account_id, m.role
    INTO v_account, v_role
    FROM profiles p
    JOIN account_members m
      ON m.user_id = p.user_id
     AND m.account_id = p.account_id
   WHERE p.user_id = auth.uid()
   LIMIT 1;

  IF v_account IS NULL THEN
    RETURN;
  END IF;

  v_can_see_email := v_role IN ('owner', 'admin');

  RETURN QUERY
    SELECT m.user_id,
           COALESCE(
             NULLIF(btrim(m.display_name), ''),
             NULLIF(p.full_name, ''),
             p.email,
             'Sin nombre'
           )::TEXT,
           NULLIF(btrim(m.display_name), '')::TEXT,
           CASE WHEN v_can_see_email THEN p.email ELSE NULL END,
           p.avatar_url,
           m.role,
           m.created_at,
           m.agent_skills
      FROM account_members m
      LEFT JOIN profiles p ON p.user_id = m.user_id
     WHERE m.account_id = v_account
     ORDER BY m.created_at ASC;
END;
$$;

ALTER FUNCTION public.account_member_roster() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.account_member_roster() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_member_roster() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   DROP FUNCTION IF EXISTS public.set_member_agent_skills(UUID, TEXT[]);
--   DROP FUNCTION IF EXISTS public.account_member_roster();
--   -- Volver a crear el roster de la 110 (sin agent_skills).
--   DROP INDEX IF EXISTS public.idx_call_sessions_queue_skills;
--   ALTER TABLE public.call_sessions
--     DROP COLUMN IF EXISTS required_skills,
--     DROP COLUMN IF EXISTS overflowed_at;
--   ALTER TABLE public.telephony_config
--     DROP CONSTRAINT IF EXISTS telephony_config_required_skills_max,
--     DROP CONSTRAINT IF EXISTS telephony_config_skill_overflow_range,
--     DROP COLUMN IF EXISTS required_skills,
--     DROP COLUMN IF EXISTS skill_overflow_seconds;
--   ALTER TABLE public.account_members
--     DROP CONSTRAINT IF EXISTS account_members_agent_skills_max,
--     DROP COLUMN IF EXISTS agent_skills;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
