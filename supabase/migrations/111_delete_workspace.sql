-- ============================================================
-- 111_delete_workspace.sql — Eliminar un negocio (solo el dueño)
--
-- Hasta ahora se podía crear, renombrar y cambiar módulos de un
-- negocio, pero no eliminarlo. Hacerlo a mano con
-- `DELETE FROM accounts` es peligroso: `profiles.account_id` apunta a
-- la cuenta ACTIVA con `ON DELETE CASCADE`, así que el borrado se
-- llevaría por delante la fila de perfil de cada miembro activo y esos
-- usuarios quedarían sin acceso.
--
-- Este RPC hace el borrado en el orden correcto, todo en una
-- transacción:
--
--   1. Verifica que quien llama sea DUEÑO del negocio objetivo.
--   2. Exige que escriba el nombre exacto (confirmación).
--   3. Rechaza borrar el único negocio de quien llama.
--   4. Reubica a cada miembro cuya cuenta activa sea la que se borra:
--      pasa a otro de sus negocios o, si no tiene ninguno, recibe uno
--      personal (misma regla que `remove_account_member`, 066).
--   5. Solo entonces borra `accounts`; el resto cae por cascada
--      (contactos, conversaciones, mensajes, embudos, POS, finanzas…).
--
-- La UI nunca toca la tabla: `account_members` solo tiene policy de
-- SELECT propio (066), así que la operación va por SECURITY DEFINER.
--
-- Requiere 066, 106 y 109. Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_workspace(
  p_account_id UUID,
  p_confirm_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_name TEXT;
  v_caller_role TEXT;
  v_caller_active UUID;
  v_other_memberships INTEGER;
  v_user_ids UUID[];
  v_uid UUID;
  v_member_name TEXT;
  v_member_email TEXT;
  v_next_account UUID;
  v_next_role account_role_enum;
  v_new_account UUID;
  v_was_active BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'Falta el negocio' USING ERRCODE = '22023';
  END IF;

  -- Bloquea la fila: evita que un renombrado concurrente invalide la
  -- confirmación a mitad de la operación.
  SELECT name INTO v_name
    FROM accounts
   WHERE id = p_account_id
   FOR UPDATE;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'El negocio no existe' USING ERRCODE = '22023';
  END IF;

  -- Dueño del negocio objetivo (no solo de su cuenta activa).
  SELECT role::text INTO v_caller_role
    FROM account_members
   WHERE user_id = v_actor
     AND account_id = p_account_id
   LIMIT 1;

  IF v_caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Solo el dueño puede eliminar este negocio'
      USING ERRCODE = '42501';
  END IF;

  IF btrim(COALESCE(p_confirm_name, '')) <> v_name THEN
    RAISE EXCEPTION 'El nombre de confirmación no coincide con el del negocio'
      USING ERRCODE = '22023';
  END IF;

  -- No puede quedarse sin ningún negocio.
  SELECT COUNT(*) INTO v_other_memberships
    FROM account_members
   WHERE user_id = v_actor
     AND account_id <> p_account_id;

  IF v_other_memberships = 0 THEN
    RAISE EXCEPTION 'No puedes eliminar tu único negocio'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_caller_active
    FROM profiles
   WHERE user_id = v_actor;

  v_was_active := (v_caller_active = p_account_id);

  -- Permite tocar `profiles` (trigger protect_profile_tenancy, 066).
  PERFORM set_config('app.tenancy_write', 'on', true);

  -- Reubicar a TODOS los perfiles cuya cuenta activa es la que se va a
  -- borrar. Sin esto, el DELETE de `accounts` los eliminaría en
  -- cascada y sus usuarios se quedarían sin perfil ni acceso.
  --
  -- Primero se materializa la lista de usuarios: actualizar `profiles`
  -- mientras se recorre la misma tabla con un cursor puede re-ver filas.
  SELECT array_agg(p.user_id)
    INTO v_user_ids
    FROM profiles p
   WHERE p.account_id = p_account_id;

  FOREACH v_uid IN ARRAY COALESCE(v_user_ids, ARRAY[]::UUID[])
  LOOP
    SELECT p.full_name, p.email
      INTO v_member_name, v_member_email
      FROM profiles p
     WHERE p.user_id = v_uid;

    v_next_account := NULL;
    v_next_role := NULL;

    -- Preferimos un negocio donde sea dueño; si no, el más antiguo.
    SELECT m.account_id, m.role
      INTO v_next_account, v_next_role
      FROM account_members m
     WHERE m.user_id = v_uid
       AND m.account_id <> p_account_id
     ORDER BY (m.role = 'owner') DESC, m.created_at ASC
     LIMIT 1;

    IF v_next_account IS NULL THEN
      -- Sin otra pertenencia: cuenta personal, igual que el registro.
      INSERT INTO accounts (name, owner_user_id)
      VALUES (
        COALESCE(NULLIF(v_member_name, ''), v_member_email, 'Mi negocio'),
        v_uid
      )
      RETURNING id INTO v_new_account;

      INSERT INTO account_members (user_id, account_id, role)
      VALUES (v_uid, v_new_account, 'owner')
      ON CONFLICT (user_id, account_id) DO UPDATE SET role = 'owner';

      v_next_account := v_new_account;
      v_next_role := 'owner';
    END IF;

    UPDATE profiles
       SET account_id   = v_next_account,
           account_role = v_next_role
     WHERE user_id = v_uid;
  END LOOP;

  -- Todos los perfiles ya apuntan a otro negocio; el borrado en
  -- cascada solo se lleva datos del negocio, no personas.
  DELETE FROM accounts WHERE id = p_account_id;

  RETURN jsonb_build_object(
    'deleted_account_id', p_account_id,
    'was_active', v_was_active,
    'active_account_id', (
      SELECT account_id FROM profiles WHERE user_id = v_actor
    )
  );
END;
$$;

ALTER FUNCTION public.delete_workspace(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_workspace(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_workspace(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   DROP FUNCTION IF EXISTS public.delete_workspace(UUID, TEXT);
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
