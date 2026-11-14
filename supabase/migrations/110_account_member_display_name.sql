-- ============================================================
-- 110_account_member_display_name.sql — Nombre visible por negocio
--
-- Hasta aquí el nombre que mostraba la app salía de
-- `profiles.full_name`, que tiene UNA fila por persona. Eso hacía que
-- un mismo login apareciera con el mismo nombre en todos los negocios
-- a los que pertenece (p. ej. "LY" también en Centro y en Prueba).
--
-- Aquí se añade `account_members.display_name`: el nombre con el que
-- una persona se presenta EN ESE NEGOCIO. Es opcional; si es NULL se
-- sigue usando `profiles.full_name` (o el correo) como respaldo, así
-- que nada cambia para quien no lo configure.
--
-- Reglas de edición (`set_member_display_name`)
--   * Cada quien puede cambiar el suyo.
--   * El dueño puede cambiar el de cualquiera de su negocio.
--   * Admin puede cambiar el de agentes y espectadores, pero no el
--     del dueño ni el de otro admin (mismo criterio que los permisos
--     del POS: solo el dueño toca a los admin).
--
-- `account_members` solo tiene policy de SELECT propio (066), así que
-- la escritura va por RPC SECURITY DEFINER, igual que el resto de
-- operaciones de la tabla.
--
-- Requiere 066, 106 y 109. Idempotente.
-- ============================================================

-- ============================================================
-- 1. Columna
-- ============================================================

ALTER TABLE public.account_members
  ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN public.account_members.display_name IS
  'Nombre con el que la persona se muestra en ESTE negocio. NULL = usar profiles.full_name.';

-- Tope defensivo: es una etiqueta de UI, no una biografía. Se recorta
-- en la RPC; el CHECK evita que un INSERT manual deje un valor absurdo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.account_members'::regclass
       AND conname = 'account_members_display_name_len'
  ) THEN
    ALTER TABLE public.account_members
      ADD CONSTRAINT account_members_display_name_len
      CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 60);
  END IF;
END $$;

-- ============================================================
-- 2. Roster con display_name
--
-- `CREATE OR REPLACE` no puede cambiar el tipo de retorno, así que hay
-- que soltar la firma anterior (109) antes de recrearla.
--
-- El nombre efectivo se resuelve aquí y no en el cliente para que
-- sidebar, header, Usuarios y el POS lean exactamente la misma regla:
--   display_name del negocio  ->  profiles.full_name  ->  correo
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
  joined_at TIMESTAMPTZ
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

  -- Cuenta activa del que llama, tomada de la pertenencia real.
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
           m.created_at
      FROM account_members m
      LEFT JOIN profiles p ON p.user_id = m.user_id
     WHERE m.account_id = v_account
     ORDER BY m.created_at ASC;
END;
$$;

ALTER FUNCTION public.account_member_roster() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.account_member_roster() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_member_roster() TO authenticated;

-- ============================================================
-- 3. RPC de edición
--
-- Devuelve el valor guardado (NULL = sin nombre propio, se usa el
-- perfil). El cliente no puede escribir la tabla directamente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_member_display_name(
  p_user_id UUID,
  p_display_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_account UUID;
  v_actor_role TEXT;
  v_target_role TEXT;
  v_clean TEXT;
  v_saved TEXT;
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

  -- Cada quien el suyo; para el resto hace falta ser admin+.
  IF p_user_id <> v_actor THEN
    IF v_actor_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;

    -- Solo el dueño puede renombrar al dueño o a otro admin.
    IF v_target_role IN ('owner', 'admin') AND v_actor_role <> 'owner' THEN
      RAISE EXCEPTION 'Solo el dueño puede cambiar el nombre de un administrador'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Vacío = borrar el alias y volver al nombre del perfil.
  v_clean := NULLIF(btrim(COALESCE(p_display_name, '')), '');

  IF v_clean IS NOT NULL AND char_length(v_clean) > 60 THEN
    RAISE EXCEPTION 'El nombre no puede superar los 60 caracteres'
      USING ERRCODE = '22023';
  END IF;

  UPDATE account_members
     SET display_name = v_clean
   WHERE user_id = p_user_id
     AND account_id = v_account
  RETURNING display_name INTO v_saved;

  RETURN v_saved;
END;
$$;

ALTER FUNCTION public.set_member_display_name(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_display_name(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_display_name(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   DROP FUNCTION IF EXISTS public.set_member_display_name(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.account_member_roster();
--   -- Volver a crear el roster de 109 (sin display_name).
--   ALTER TABLE public.account_members
--     DROP CONSTRAINT IF EXISTS account_members_display_name_len;
--   ALTER TABLE public.account_members DROP COLUMN IF EXISTS display_name;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
