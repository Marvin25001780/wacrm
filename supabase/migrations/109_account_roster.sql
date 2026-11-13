-- ============================================================
-- 109_account_roster.sql — Lista de usuarios por negocio
--
-- La pestaña Ajustes → Usuarios y los permisos del POS leían
-- `profiles` como si tuviera una fila por negocio. Con la
-- multipertenencia de la 066, `profiles` tiene UNA fila por persona y
-- `account_id` / `account_role` solo reflejan su cuenta ACTIVA. Eso
-- producía dos fallos, sin mezclar datos:
--
--   * un miembro cuya cuenta activa es otro negocio desaparecía de la
--     lista de Usuarios del negocio en el que sí está;
--   * `pos_set_permission` / `pos_reset_user_permissions` respondían
--     "El usuario no pertenece al negocio" en ese mismo caso.
--
-- Aquí se añade `account_member_roster()`, que lista la plantilla
-- desde `account_members` (la fuente de verdad de 066) y solo
-- devuelve el negocio activo de quien llama. El correo se incluye
-- únicamente para owner/admin, igual que hacía la ruta.
--
-- Requiere 066 y 106. Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.account_member_roster()
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
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
           COALESCE(NULLIF(p.full_name, ''), p.email, 'Sin nombre')::TEXT,
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

-- ------------------------------------------------------------
-- POS — el objetivo de un permiso se busca en account_members
--
-- Solo cambia el SELECT del rol del objetivo: antes leía
-- `profiles.account_role` filtrado por la cuenta, que solo existe
-- cuando esa cuenta es la activa del objetivo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_set_permission(
  p_user_id UUID,
  p_capability TEXT,
  p_allowed BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_account UUID;
  v_actor_role TEXT;
  v_target_role TEXT;
  v_default BOOLEAN;
  v_allowed BOOLEAN := COALESCE(p_allowed, FALSE);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT account_id, account_role::text
    INTO v_account, v_actor_role
    FROM profiles
   WHERE user_id = v_actor
   LIMIT 1;

  IF v_account IS NULL OR NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF NOT pos_can_for(v_account, 'manage_users') THEN
    RAISE EXCEPTION 'No tienes permiso para: Administrar usuarios y permisos';
  END IF;

  IF NOT (p_capability = ANY (pos_capability_keys())) THEN
    RAISE EXCEPTION 'Permiso desconocido: %', p_capability;
  END IF;

  SELECT m.role::text INTO v_target_role
    FROM account_members m
   WHERE m.user_id = p_user_id
     AND m.account_id = v_account
   LIMIT 1;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'El usuario no pertenece al negocio';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'El dueño siempre tiene todos los permisos';
  END IF;

  IF v_actor_role <> 'owner' AND v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Solo el dueño puede cambiar permisos de administradores';
  END IF;

  v_default := pos_default_permission(v_target_role, p_capability);

  IF v_allowed = v_default THEN
    DELETE FROM pos_permissions
     WHERE account_id = v_account
       AND user_id = p_user_id
       AND capability = p_capability;
  ELSE
    INSERT INTO pos_permissions (
      account_id, user_id, capability, allowed, updated_by, updated_at
    ) VALUES (
      v_account, p_user_id, p_capability, v_allowed, v_actor, NOW()
    )
    ON CONFLICT (account_id, user_id, capability) DO UPDATE
      SET allowed = EXCLUDED.allowed,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW();
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'capability', p_capability,
    'allowed', v_allowed,
    'is_default', v_allowed = v_default
  );
END;
$$;

CREATE OR REPLACE FUNCTION pos_reset_user_permissions(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_account UUID;
  v_actor_role TEXT;
  v_target_role TEXT;
  v_count INTEGER;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT account_id, account_role::text
    INTO v_account, v_actor_role
    FROM profiles
   WHERE user_id = v_actor
   LIMIT 1;

  IF v_account IS NULL OR NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF NOT pos_can_for(v_account, 'manage_users') THEN
    RAISE EXCEPTION 'No tienes permiso para: Administrar usuarios y permisos';
  END IF;

  SELECT m.role::text INTO v_target_role
    FROM account_members m
   WHERE m.user_id = p_user_id
     AND m.account_id = v_account
   LIMIT 1;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'El usuario no pertenece al negocio';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'El dueño siempre tiene todos los permisos';
  END IF;

  IF v_actor_role <> 'owner' AND v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Solo el dueño puede cambiar permisos de administradores';
  END IF;

  DELETE FROM pos_permissions
   WHERE account_id = v_account
     AND user_id = p_user_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('user_id', p_user_id, 'removed', v_count);
END;
$$;

NOTIFY pgrst, 'reload schema';
