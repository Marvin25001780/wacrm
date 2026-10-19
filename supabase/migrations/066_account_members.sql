-- ============================================================
-- 066_account_members.sql — Multipertenencia (varios espacios de trabajo)
--
-- Objetivo: que un usuario pueda pertenecer a VARIAS cuentas
-- ("espacios de trabajo") con un rol distinto en cada una, y cambiar
-- entre ellas, sin tocar las políticas RLS de dominio.
--
-- Idea central (Diseño A, doc docs/diseno-multiespacio-y-varios-numeros.md §2)
--   - `account_members(user_id, account_id, role)` pasa a ser la
--     FUENTE DE VERDAD de las pertenencias.
--   - `profiles.account_id` / `profiles.account_role` siguen
--     existiendo y pasan a significar "cuenta ACTIVA y rol en ella".
--   - `is_account_member()` conserva firma y semántica (un tenant a
--     la vez), solo cambia de dónde lee. Por eso NINGUNA policy de
--     dominio necesita cambios.
--
-- Contenido:
--   1. Pre-vuelo: los perfiles deben tener cuenta/rol (si no, aborta).
--   2. Tabla `account_members` + backfill desde `profiles` + owner garantizado.
--   3. RLS de `account_members` (cada quien ve sus membresías).
--   4. `is_account_member` (nueva fuente) + `is_account_affiliate`.
--   5. `accounts_select` incluye las cuentas afiliadas (para el selector).
--   6. Trigger `protect_profile_tenancy` (cierra S3: autoascenso de rol
--      y cambio de tenant desde el cliente).
--   7. RPCs nuevas: `switch_active_account`, `create_workspace`.
--   8. Reescritura de las 5 funciones que escriben la pertenencia
--      (`handle_new_user`, `redeem_invitation`, `remove_account_member`,
--      `transfer_account_ownership`, `set_member_role`).
--   9. Se elimina `idx_accounts_one_per_owner` (un usuario podrá ser
--      dueño de más de un espacio); la invariante "1 owner por cuenta"
--      se traslada a `account_members`.
--  10. S17: `audit_row()` deja de romper el borrado de cuentas.
--  11. Comprobaciones finales de integridad.
--
-- Orden de ejecución (obligatorio, en una sola transacción):
--   tabla -> backfill -> reemplazo de `is_account_member`.
--   Al revés, la app se queda sin acceso durante la ventana.
--
-- Entorno: se aplica primero en DEV. Producción solo cuando se pida.
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. PRE-VUELO
--
-- `is_account_member` va a leer de `account_members`, que se
-- backfillea desde `profiles`. Si hubiera perfiles con
-- account_id/account_role NULL, quedarían sin membresía y sin acceso
-- (fallo silencioso). Mejor abortar con un mensaje claro.
-- ============================================================
DO $$
DECLARE
  v_bad INTEGER;
BEGIN
  SELECT count(*) INTO v_bad
  FROM profiles
  WHERE account_id IS NULL OR account_role IS NULL;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'Pre-vuelo 066: % perfiles sin account_id/account_role. Corrige antes de aplicar (seccion 7 del diseno).',
      v_bad;
  END IF;
END $$;

-- ============================================================
-- 2. TABLA account_members
-- ============================================================
CREATE TABLE IF NOT EXISTS account_members (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role       account_role_enum NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_account_members_account
  ON account_members(account_id);

-- Backfill idempotente desde la pertenencia única actual.
INSERT INTO account_members (user_id, account_id, role)
SELECT user_id, account_id, account_role
FROM profiles
WHERE account_id IS NOT NULL AND account_role IS NOT NULL
ON CONFLICT (user_id, account_id) DO NOTHING;

-- Toda cuenta debe tener exactamente un owner. Si al dueño
-- denormalizado (`accounts.owner_user_id`) le falta la membresía con
-- rol owner, se la añadimos aquí. Solo actúa si NO existe ya un owner
-- para esa cuenta, así que no puede crear un segundo.
INSERT INTO account_members (user_id, account_id, role)
SELECT a.owner_user_id, a.id, 'owner'
FROM accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM account_members m
  WHERE m.account_id = a.id AND m.role = 'owner'
)
ON CONFLICT (user_id, account_id) DO UPDATE SET role = 'owner';

-- Comprobación de que el backfill está completo ANTES de cambiar la
-- función: cada perfil debe tener su membresía en su cuenta activa.
DO $$
DECLARE
  v_missing INTEGER;
BEGIN
  SELECT count(*) INTO v_missing
  FROM profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM account_members m
    WHERE m.user_id = p.user_id AND m.account_id = p.account_id
  );

  IF v_missing > 0 THEN
    RAISE EXCEPTION
      'Backfill 066 incompleto: % perfiles sin membresia en account_members.', v_missing;
  END IF;
END $$;

-- Exactamente un owner por cuenta. Si hubiera dos (datos
-- inconsistentes), la creación del índice falla y aborta la migración:
-- preferible a un estado ambiguo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_members_one_owner
  ON account_members(account_id) WHERE role = 'owner';

-- ============================================================
-- 3. RLS de account_members
--
-- Cada usuario ve SOLO sus propias membresías (columnas directas:
-- sin recursión). Escribir solo por RPC (SECURITY DEFINER), que pasan
-- por encima de RLS.
-- ============================================================
ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_members_select_own ON account_members;
CREATE POLICY account_members_select_own ON account_members FOR SELECT
  USING (user_id = auth.uid());

-- Supabase concede permisos por defecto a las tablas de `public`, pero
-- se declaran aquí explícitamente: la lectura por `authenticated` es
-- necesaria para el selector de espacios y nadie debe poder escribir
-- desde el cliente (solo las RPC SECURITY DEFINER).
REVOKE ALL ON account_members FROM anon, authenticated;
GRANT SELECT ON account_members TO authenticated;
GRANT ALL ON account_members TO service_role;

-- ============================================================
-- 4. HELPER DE PERTENENCIA — misma firma, nueva fuente
--
-- Se mantiene anclado a `profiles.account_id` (cuenta ACTIVA): la RLS
-- no cambia de semántica, un usuario ve un tenant a la vez.
--
-- El rol se lee de `account_members.role`, que es la fuente de verdad;
-- `profiles.account_role` es una copia de conveniencia para el rol de
-- la cuenta activa (lo usa getCurrentAccount/requireRole en la app).
-- ============================================================
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN account_members m
      ON m.user_id    = p.user_id
     AND m.account_id = p.account_id          -- solo la cuenta ACTIVA
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE m.role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- ============================================================
-- 5. HELPER DE AFILIACIÓN — para el selector de espacios
--
-- "¿Pertenece a esta cuenta, sea o no la activa?" Lo necesita
-- `accounts_select` para poder listar las cuentas del selector.
-- No se usa en las policies de dominio (esas siguen con la activa).
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_account_affiliate(target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM account_members m
    WHERE m.user_id = auth.uid()
      AND m.account_id = target_account_id
  );
$$;

ALTER FUNCTION public.is_account_affiliate(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.is_account_affiliate(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS accounts_select ON accounts;
CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (is_account_member(id) OR is_account_affiliate(id));

-- ============================================================
-- 6. S3 — Bloquear el autoascenso de rol y el cambio de tenant
--
-- `profiles_update` (017:614) solo exige `auth.uid() = user_id`, sin
-- restringir columnas: con el cliente del navegador un usuario podía
-- hacer `PATCH profiles SET account_role='owner'` o mudarse a otra
-- cuenta. En el modelo de multipertenencia eso es CRÍTICO, porque
-- `account_id` es el conmutador de tenant.
--
-- Solución: un trigger BEFORE UPDATE que impide cambiar
-- account_id/account_role salvo cuando la escritura viene de una RPC
-- autorizada (que marca `app.tenancy_write = 'on'`, local a la
-- transacción). Las autoediciones legítimas (full_name, avatar_url)
-- no tocan esas columnas y siguen funcionando igual.
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_profile_tenancy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.account_role IS DISTINCT FROM OLD.account_role)
     AND current_setting('app.tenancy_write', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'account_id/account_role solo cambian por RPC'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_profile_tenancy() OWNER TO postgres;

DROP TRIGGER IF EXISTS protect_profile_tenancy ON profiles;
CREATE TRIGGER protect_profile_tenancy
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_tenancy();

-- ============================================================
-- 7. RPCs NUEVAS
-- ============================================================

-- ─── switch_active_account(p_account_id) ────────────────────────
-- Cambia la cuenta activa del usuario que llama. Valida la
-- pertenencia dentro de la función (no basta con ocultar el botón).
CREATE OR REPLACE FUNCTION public.switch_active_account(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role
  FROM account_members
  WHERE user_id = auth.uid() AND account_id = p_account_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Not a member of that account' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.tenancy_write', 'on', true);

  UPDATE profiles
  SET account_id   = p_account_id,
      account_role = v_role
  WHERE user_id = auth.uid();
END;
$$;

ALTER FUNCTION public.switch_active_account(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.switch_active_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.switch_active_account(UUID) TO authenticated;

-- ─── create_workspace(p_name) ───────────────────────────────────
-- Crea un espacio de trabajo nuevo; el que llama queda como owner y
-- el espacio pasa a ser su cuenta activa.
--
-- Decisión de producto: solo admin+ de su cuenta ACTIVA puede crear
-- espacios. Se valida aquí dentro: un agent/viewer recibe 403 real
-- aunque llame a la RPC directamente.
CREATE OR REPLACE FUNCTION public.create_workspace(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_is_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Name is required' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN account_members m
      ON m.user_id = p.user_id AND m.account_id = p.account_id
    WHERE p.user_id = auth.uid()
      AND m.role IN ('owner', 'admin')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can create workspaces' USING ERRCODE = '42501';
  END IF;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (btrim(p_name), auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO account_members (user_id, account_id, role)
  VALUES (auth.uid(), v_id, 'owner');

  PERFORM set_config('app.tenancy_write', 'on', true);

  UPDATE profiles
  SET account_id = v_id,
      account_role = 'owner'
  WHERE user_id = auth.uid();

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.create_workspace(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_workspace(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workspace(TEXT) TO authenticated;

-- ============================================================
-- 8. REESCRITURA DE LAS 5 FUNCIONES QUE ESCRIBEN LA PERTENENCIA
-- ============================================================

-- ─── handle_new_user ────────────────────────────────────────────
-- Un usuario nuevo tiene su cuenta personal en account_members con
-- rol owner. Si se olvida, NINGÚN registro pasa is_account_member y
-- la app queda inservible para esa persona.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  -- Fuente de verdad de la pertenencia.
  INSERT INTO public.account_members (user_id, account_id, role)
  VALUES (NEW.id, v_account_id, 'owner')
  ON CONFLICT (user_id, account_id) DO UPDATE SET role = 'owner';

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── redeem_invitation ──────────────────────────────────────────
-- CAMBIO DE FONDO: aceptar una invitación ya no "muda" al usuario ni
-- borra su cuenta personal. Añade una MEMBRESÍA y deja esa cuenta
-- como activa. Desaparecen las restricciones "ya estás en una cuenta
-- compartida" y "tu cuenta tiene datos": con multipertenencia, tener
-- datos propios y unirse a otro espacio es exactamente el caso normal.
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID  -- la cuenta a la que se unió
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_has_profile BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Lock de la fila: dos redeems concurrentes del mismo token no
  -- pueden ganar los dos.
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Defensivo: todo usuario autenticado tiene perfil desde 017.
  SELECT EXISTS (SELECT 1 FROM profiles WHERE user_id = v_caller_id)
  INTO v_has_profile;
  IF NOT v_has_profile THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  -- Ya es miembro (p. ej. reenvío del enlace): no es un error de
  -- datos, pero no hay nada que hacer. 23505 → 409 como antes.
  IF EXISTS (
    SELECT 1 FROM account_members
    WHERE user_id = v_caller_id AND account_id = v_inv.account_id
  ) THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO account_members (user_id, account_id, role)
  VALUES (v_caller_id, v_inv.account_id, v_inv.role);

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- La cuenta recién unida pasa a ser la activa.
  PERFORM set_config('app.tenancy_write', 'on', true);
  UPDATE profiles
  SET account_id   = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- ─── set_member_role ────────────────────────────────────────────
-- Actualiza el rol en `account_members` (fuente de verdad) y, si el
-- objetivo tiene esta cuenta como ACTIVA, sincroniza
-- `profiles.account_role`.
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  -- El objetivo tiene que ser miembro de MI cuenta (no basta con
  -- existir: ahora un usuario puede estar en varias).
  SELECT role INTO v_target_role
  FROM account_members
  WHERE user_id = p_user_id AND account_id = v_caller_account_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE account_members
  SET role = p_new_role
  WHERE user_id = p_user_id AND account_id = v_caller_account_id;

  -- Si esa cuenta es la activa del objetivo, su perfil debe reflejar
  -- el rol nuevo (lo usa requireRole en la app).
  PERFORM set_config('app.tenancy_write', 'on', true);
  UPDATE profiles
  SET account_role = p_new_role
  WHERE user_id = p_user_id AND account_id = v_caller_account_id;
END;
$$;

ALTER FUNCTION public.set_member_role(UUID, account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_role(UUID, account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, account_role_enum) TO authenticated;

-- ─── remove_account_member ──────────────────────────────────────
-- Quita una membresía. El usuario NO se borra ni se destruye su
-- trabajo: si la cuenta activa era esta, se le deja activa otra de
-- sus membresías (o una cuenta personal nueva si no tiene ninguna).
CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID  -- la cuenta activa del expulsado al terminar
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_role account_role_enum;
  v_target_active UUID;
  v_target_name TEXT;
  v_target_email TEXT;
  v_next_account_id UUID;
  v_next_role account_role_enum;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_target_role
  FROM account_members
  WHERE user_id = p_user_id AND account_id = v_caller_account_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, full_name, email
  INTO v_target_active, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  -- Fuera de la cuenta.
  DELETE FROM account_members
  WHERE user_id = p_user_id AND account_id = v_caller_account_id;

  -- ¿Le queda alguna membresía? Se prefiere la que tenga como dueño
  -- y, en su defecto, la más antigua.
  SELECT m.account_id, m.role
  INTO v_next_account_id, v_next_role
  FROM account_members m
  WHERE m.user_id = p_user_id
  ORDER BY (m.role = 'owner') DESC, m.created_at ASC
  LIMIT 1;

  IF v_next_account_id IS NULL THEN
    -- Sin ninguna pertenencia: le creamos una cuenta personal, igual
    -- que el trigger de registro. Así nunca se queda sin acceso.
    INSERT INTO accounts (name, owner_user_id)
    VALUES (
      COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
      p_user_id
    )
    RETURNING id INTO v_new_account_id;

    INSERT INTO account_members (user_id, account_id, role)
    VALUES (p_user_id, v_new_account_id, 'owner')
    ON CONFLICT (user_id, account_id) DO UPDATE SET role = 'owner';

    v_next_account_id := v_new_account_id;
    v_next_role := 'owner';
  END IF;

  -- Solo se toca el perfil si su cuenta ACTIVA era la que perdimos.
  IF v_target_active = v_caller_account_id THEN
    PERFORM set_config('app.tenancy_write', 'on', true);
    UPDATE profiles
    SET account_id   = v_next_account_id,
        account_role = v_next_role
    WHERE user_id = p_user_id;
  END IF;

  RETURN v_next_account_id;
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;

-- ─── transfer_account_ownership ─────────────────────────────────
-- Sincroniza `accounts.owner_user_id` Y los roles en
-- `account_members` (la invariante "1 owner por cuenta" vive ahí).
CREATE OR REPLACE FUNCTION public.transfer_account_ownership(
  p_new_owner_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner'
      USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_target_role
  FROM account_members
  WHERE user_id = p_new_owner_user_id AND account_id = v_caller_account_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Se degrada primero al owner actual: así el estado intermedio
  -- "cero owners" nunca es visible (todo va en la misma transacción).
  UPDATE account_members SET role = 'admin'
  WHERE user_id = auth.uid() AND account_id = v_caller_account_id;

  UPDATE account_members SET role = 'owner'
  WHERE user_id = p_new_owner_user_id AND account_id = v_caller_account_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_caller_account_id;

  PERFORM set_config('app.tenancy_write', 'on', true);

  UPDATE profiles SET account_role = 'admin'
  WHERE user_id = auth.uid() AND account_id = v_caller_account_id;

  UPDATE profiles SET account_role = 'owner'
  WHERE user_id = p_new_owner_user_id AND account_id = v_caller_account_id;
END;
$$;

ALTER FUNCTION public.transfer_account_ownership(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID) TO authenticated;

-- ============================================================
-- 9. Un usuario ya puede ser dueño de más de un espacio
--
-- La invariante "un usuario, una cuenta" era el candado del diseño
-- anterior. Ahora vive en `account_members` (1 owner por CUENTA, N
-- cuentas por usuario).
-- ============================================================
DROP INDEX IF EXISTS idx_accounts_one_per_owner;

-- ============================================================
-- 10. S17 — el trigger de auditoría rompía el borrado de cuentas
--
-- `audit_logs.account_id` referencia `accounts(id) ON DELETE CASCADE`
-- y el trigger genérico inserta una fila de auditoría por cada cambio.
-- Al borrar una cuenta, los borrados EN CASCADA de sus tablas hijas
-- (contacts, tags, pipelines...) disparaban el trigger cuando la fila
-- de `accounts` ya estaba eliminada → violación de FK (23503) y el
-- borrado entero abortaba con 409. Reproducido en dev.
--
-- Arreglo: si la cuenta ya no existe, no hay nada que auditar (el
-- historial se va con ella por el ON DELETE CASCADE). Se captura SOLO
-- la violación de clave foránea, que aquí únicamente puede venir de
-- `account_id` (actor_id no tiene FK).
-- ============================================================
CREATE OR REPLACE FUNCTION public.audit_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before_row jsonb;
  after_row  jsonb;
  acct       uuid;
  rec        uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    before_row := to_jsonb(OLD);
  ELSIF (TG_OP = 'UPDATE') THEN
    before_row := to_jsonb(OLD);
    after_row  := to_jsonb(NEW);
  ELSE
    after_row := to_jsonb(NEW);
  END IF;

  -- Strip sensitive columns so they never reach the audit trail.
  IF before_row IS NOT NULL THEN
    before_row := before_row
      - 'api_key' - 'access_token' - 'secret' - 'smtp_pass'
      - 'webhook_secret' - 'custom_webhook_secret'
      - 'verify_token' - 'app_secret';
  END IF;
  IF after_row IS NOT NULL THEN
    after_row := after_row
      - 'api_key' - 'access_token' - 'secret' - 'smtp_pass'
      - 'webhook_secret' - 'custom_webhook_secret'
      - 'verify_token' - 'app_secret';
  END IF;

  acct := COALESCE((after_row ->> 'account_id')::uuid, (before_row ->> 'account_id')::uuid);
  rec  := COALESCE((after_row ->> 'id')::uuid, (before_row ->> 'id')::uuid);

  -- Tables without an account scope aren't audited.
  IF acct IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN
    INSERT INTO audit_logs (
      account_id, actor_id, actor_email, table_name, operation, record_id, changes
    ) VALUES (
      acct,
      auth.uid(),
      auth.jwt() ->> 'email',
      TG_TABLE_NAME,
      TG_OP,
      rec,
      jsonb_strip_nulls(
        jsonb_build_object('before', before_row, 'after', after_row)
      )
    );
  EXCEPTION WHEN foreign_key_violation THEN
    -- La cuenta se está borrando (borrado en cascada): el historial se
    -- elimina con ella, así que no hay nada que auditar. Ver S17.
    NULL;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$$;

ALTER FUNCTION public.audit_row() OWNER TO postgres;

-- ============================================================
-- 11. COMPROBACIONES FINALES
--
-- Fallan la migración (y con ella la transacción) si el estado no es
-- el esperado. Mejor que arrancar con la multipertenencia a medias.
-- ============================================================
DO $$
DECLARE
  v_no_membership INTEGER;
  v_multi_owner INTEGER;
BEGIN
  -- (a) Ningún perfil sin membresía en su cuenta activa.
  SELECT count(*) INTO v_no_membership
  FROM profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM account_members m
    WHERE m.user_id = p.user_id AND m.account_id = p.account_id
  );
  IF v_no_membership > 0 THEN
    RAISE EXCEPTION '066: % perfiles sin membresia activa', v_no_membership;
  END IF;

  -- (b) Ninguna cuenta con más de un owner.
  SELECT count(*) INTO v_multi_owner
  FROM (
    SELECT account_id FROM account_members
    WHERE role = 'owner'
    GROUP BY account_id HAVING count(*) > 1
  ) t;
  IF v_multi_owner > 0 THEN
    RAISE EXCEPTION '066: % cuentas con mas de un owner', v_multi_owner;
  END IF;
END $$;

-- ============================================================
-- ROLLBACK (solo si algo sale mal; NO se ejecuta solo)
--
-- El rollback mínimo y suficiente: devolver `is_account_member` a
-- leer de `profiles` y quitar el `is_account_affiliate` de
-- `accounts_select`. Con eso el sistema vuelve a comportarse como
-- antes de 066; `account_members` queda inerte (nadie la lee) y se
-- puede borrar cuando se quiera.
--
--   CREATE OR REPLACE FUNCTION is_account_member(
--     target_account_id UUID,
--     min_role account_role_enum DEFAULT 'viewer'
--   ) RETURNS BOOLEAN
--   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
--   AS $$
--     SELECT EXISTS (
--       SELECT 1 FROM profiles p
--       WHERE p.user_id = auth.uid()
--         AND p.account_id = target_account_id
--         AND CASE p.account_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3
--                                 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
--           >= CASE min_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3
--                            WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
--     );
--   $$;
--
--   DROP POLICY IF EXISTS accounts_select ON accounts;
--   CREATE POLICY accounts_select ON accounts FOR SELECT
--     USING (is_account_member(id));
--
--   DROP TRIGGER IF EXISTS protect_profile_tenancy ON profiles;
--
-- Opcional (solo si no hay todavía usuarios con más de un espacio):
--   DROP INDEX IF EXISTS idx_accounts_one_per_owner; se recrearía con
--   CREATE UNIQUE INDEX idx_accounts_one_per_owner ON accounts(owner_user_id);
--   -- Falla si alguien ya creó un segundo espacio: es la señal de que
--   -- el rollback completo ya no es inocuo.
--
-- Nota: el arreglo de S17 en `audit_row()` es independiente y no hace
-- falta revertirlo (solo elimina un fallo al borrar cuentas).
-- ============================================================
