-- ============================================================
-- 106_pos_permissions.sql — Control del POS
--
-- Tres piezas del Bloque 3:
--
-- 1. Permisos finos por usuario. Los roles siguen mandando, pero
--    el dueño/administrador puede conceder o quitar una capacidad
--    concreta a una persona sin cambiarle el rol del CRM.
-- 2. Límite de crédito por cliente del POS. NULL = sin límite,
--    0 = no puede llevar saldo.
-- 3. Cobro de venta con validación de cliente y límite, más
--    guardas en las tablas para que las reglas no dependan solo
--    de la pantalla.
--
-- Los permisos se aplican en dos capas:
--   - RLS restrictiva para escrituras directas del navegador
--     (catálogo, contactos, configuración, caja…).
--   - Triggers en las tablas que escriben las RPC del POS
--     (ventas, inventario, finanzas, turnos…). Las RPC son
--     SECURITY DEFINER y por eso no las cubre RLS.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Límite de crédito
-- ------------------------------------------------------------
ALTER TABLE pos_customers
  ADD COLUMN IF NOT EXISTS credit_limit_usd NUMERIC(14,2);

ALTER TABLE pos_customers
  DROP CONSTRAINT IF EXISTS pos_customers_credit_limit_check;
ALTER TABLE pos_customers
  ADD CONSTRAINT pos_customers_credit_limit_check
  CHECK (credit_limit_usd IS NULL OR credit_limit_usd >= 0);

COMMENT ON COLUMN pos_customers.credit_limit_usd IS
  'NULL = sin límite; 0 = no puede comprar a crédito; > 0 = tope de saldo pendiente en USD.';

-- ------------------------------------------------------------
-- 2. Tabla de permisos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, user_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_pos_permissions_account
  ON pos_permissions(account_id, user_id);

ALTER TABLE pos_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_permissions_select ON pos_permissions;
DROP POLICY IF EXISTS pos_permissions_write ON pos_permissions;

CREATE POLICY pos_permissions_select ON pos_permissions
  FOR SELECT USING (
    is_account_member(account_id, 'admin') OR user_id = auth.uid()
  );

-- Nadie escribe la tabla directamente: se usa pos_set_permission().
REVOKE INSERT, UPDATE, DELETE ON pos_permissions FROM authenticated;
GRANT SELECT ON pos_permissions TO authenticated;

-- La bitácora de permisos es crítica: se engancha aquí porque la
-- tabla se crea en esta misma migración.
DROP TRIGGER IF EXISTS audit_pos_permissions ON pos_permissions;
CREATE TRIGGER audit_pos_permissions
  AFTER INSERT OR UPDATE OR DELETE ON pos_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ------------------------------------------------------------
-- 3. Catálogo de capacidades
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_capability_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'sell',
    'sell_credit',
    'apply_discount',
    'collect_credit',
    'issue_returns',
    'issue_invoices',
    'void_sales',
    'manage_customers',
    'manage_catalog',
    'manage_inventory',
    'manage_finance',
    'view_reports',
    'manage_shifts',
    'manage_settings',
    'manage_users',
    'view_audit',
    'manage_credit_limits'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION pos_capability_label(p_capability TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_capability
    WHEN 'sell' THEN 'Vender'
    WHEN 'sell_credit' THEN 'Vender a crédito'
    WHEN 'apply_discount' THEN 'Aplicar descuentos y recargos'
    WHEN 'collect_credit' THEN 'Cobrar abonos de crédito'
    WHEN 'issue_returns' THEN 'Registrar devoluciones'
    WHEN 'issue_invoices' THEN 'Emitir facturas fiscales'
    WHEN 'void_sales' THEN 'Anular ventas'
    WHEN 'manage_customers' THEN 'Gestionar contactos'
    WHEN 'manage_catalog' THEN 'Gestionar catálogo y precios'
    WHEN 'manage_inventory' THEN 'Gestionar inventario y compras'
    WHEN 'manage_finance' THEN 'Gestionar cuentas y gastos'
    WHEN 'view_reports' THEN 'Ver informes'
    WHEN 'manage_shifts' THEN 'Abrir y cerrar turnos'
    WHEN 'manage_settings' THEN 'Editar ajustes del negocio'
    WHEN 'manage_users' THEN 'Administrar usuarios y permisos'
    WHEN 'view_audit' THEN 'Ver la bitácora'
    WHEN 'manage_credit_limits' THEN 'Asignar límites de crédito'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION pos_default_permission(
  p_role TEXT,
  p_capability TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_role IN ('owner', 'admin') THEN
      p_capability = ANY (pos_capability_keys())
    WHEN p_role = 'agent' THEN
      p_capability = ANY (ARRAY[
        'sell',
        'sell_credit',
        'apply_discount',
        'collect_credit',
        'issue_returns',
        'issue_invoices',
        'manage_customers',
        'manage_catalog',
        'manage_inventory',
        'manage_finance',
        'view_reports',
        'manage_shifts'
      ]::TEXT[])
    WHEN p_role = 'viewer' THEN
      p_capability = ANY (ARRAY['view_reports']::TEXT[])
    ELSE FALSE
  END;
$$;

-- ------------------------------------------------------------
-- 4. Consulta y administración de permisos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_can_for(
  p_account_id UUID,
  p_capability TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_role TEXT;
  v_allowed BOOLEAN;
BEGIN
  -- Sin JWT (service role, webhooks, tareas internas) no se limita.
  IF v_user IS NULL THEN
    RETURN TRUE;
  END IF;

  IF p_account_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT (p_capability = ANY (pos_capability_keys())) THEN
    RETURN FALSE;
  END IF;

  SELECT account_role::text INTO v_role
    FROM profiles
   WHERE user_id = v_user
     AND account_id = p_account_id
   LIMIT 1;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT allowed INTO v_allowed
    FROM pos_permissions
   WHERE account_id = p_account_id
     AND user_id = v_user
     AND capability = p_capability;

  IF FOUND THEN
    RETURN v_allowed;
  END IF;

  RETURN pos_default_permission(v_role, p_capability);
END;
$$;

CREATE OR REPLACE FUNCTION pos_can(p_capability TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT account_id INTO v_account
    FROM profiles
   WHERE user_id = auth.uid()
   LIMIT 1;

  RETURN pos_can_for(v_account, p_capability);
END;
$$;

CREATE OR REPLACE FUNCTION pos_require_for(
  p_account_id UUID,
  p_capability TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT pos_can_for(p_account_id, p_capability) THEN
    RAISE EXCEPTION 'No tienes permiso para: %',
      COALESCE(pos_capability_label(p_capability), p_capability);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pos_my_permissions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_role TEXT;
  v_capability TEXT;
  v_permissions JSONB := '{}'::jsonb;
BEGIN
  SELECT account_id, account_role::text
    INTO v_account, v_role
    FROM profiles
   WHERE user_id = auth.uid()
   LIMIT 1;

  IF v_account IS NULL THEN
    RETURN jsonb_build_object(
      'role', NULL,
      'permissions', '{}'::jsonb
    );
  END IF;

  FOREACH v_capability IN ARRAY pos_capability_keys() LOOP
    v_permissions := v_permissions || jsonb_build_object(
      v_capability,
      pos_can_for(v_account, v_capability)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'role', v_role,
    'permissions', v_permissions
  );
END;
$$;

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

  SELECT account_role::text INTO v_target_role
    FROM profiles
   WHERE user_id = p_user_id
     AND account_id = v_account
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

  SELECT account_role::text INTO v_target_role
    FROM profiles
   WHERE user_id = p_user_id
     AND account_id = v_account
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

-- ------------------------------------------------------------
-- 5. Bitácora por capacidad
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_audit_logs(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
  id UUID,
  table_name TEXT,
  operation TEXT,
  actor_email TEXT,
  record_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT account_id INTO v_account
    FROM profiles
   WHERE user_id = auth.uid()
   LIMIT 1;

  IF v_account IS NULL THEN
    RETURN;
  END IF;

  IF NOT pos_can_for(v_account, 'view_audit') THEN
    RAISE EXCEPTION 'No tienes permiso para: Ver la bitácora';
  END IF;

  RETURN QUERY
    SELECT l.id,
           l.table_name,
           l.operation,
           l.actor_email,
           l.record_id,
           l.created_at
      FROM audit_logs l
     WHERE l.account_id = v_account
       AND l.table_name LIKE 'pos_%'
     ORDER BY l.created_at DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END;
$$;

-- ------------------------------------------------------------
-- 6. Guardas de crédito en clientes
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_guard_customer_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.credit_limit_usd IS NULL
       AND NOT pos_can_for(NEW.account_id, 'manage_credit_limits') THEN
      -- Un usuario sin esta capacidad no puede crear clientes con
      -- crédito ilimitado. Entra en 0 y un administrador lo ajusta.
      NEW.credit_limit_usd := 0;
    ELSIF NEW.credit_limit_usd IS NOT NULL
       AND NOT pos_can_for(NEW.account_id, 'manage_credit_limits') THEN
      RAISE EXCEPTION 'No tienes permiso para: Asignar límites de crédito';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.credit_limit_usd IS DISTINCT FROM OLD.credit_limit_usd
     AND NOT pos_can_for(NEW.account_id, 'manage_credit_limits') THEN
    RAISE EXCEPTION 'No tienes permiso para: Asignar límites de crédito';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_customer_credit ON pos_customers;
CREATE TRIGGER guard_customer_credit
  BEFORE INSERT OR UPDATE ON pos_customers
  FOR EACH ROW EXECUTE FUNCTION pos_guard_customer_credit();

-- ------------------------------------------------------------
-- 7. Guardas de ventas
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_guard_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pos_require_for(NEW.account_id, 'sell');
    RETURN NEW;
  END IF;

  IF NEW.status = 'void' AND COALESCE(OLD.status, '') <> 'void' THEN
    PERFORM pos_require_for(NEW.account_id, 'void_sales');
  END IF;

  -- La venta nace en 'paid' con saldo 0 y la RPC actualiza los
  -- totales al final: el cambio de saldo es la señal real de que
  -- se está fiando.
  IF COALESCE(NEW.balance_usd, 0) > 0.005
     AND COALESCE(OLD.balance_usd, 0) <= 0.005 THEN
    PERFORM pos_require_for(NEW.account_id, 'sell_credit');
  END IF;

  IF COALESCE(NEW.discount_usd, 0) > 0.005
     AND COALESCE(OLD.discount_usd, 0) <= 0.005 THEN
    PERFORM pos_require_for(NEW.account_id, 'apply_discount');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_sale_capabilities ON pos_sales;
CREATE TRIGGER guard_sale_capabilities
  BEFORE INSERT OR UPDATE ON pos_sales
  FOR EACH ROW EXECUTE FUNCTION pos_guard_sale();

-- ------------------------------------------------------------
-- 8. Guardas genéricas por tabla
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_guard_table_capability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capability TEXT;
  v_account UUID;
BEGIN
  v_capability := CASE TG_TABLE_NAME
    WHEN 'pos_sale_returns' THEN 'issue_returns'
    WHEN 'pos_sale_return_items' THEN 'issue_returns'
    WHEN 'pos_inventory_docs' THEN 'manage_inventory'
    WHEN 'pos_inventory_doc_items' THEN 'manage_inventory'
    WHEN 'pos_shifts' THEN 'manage_shifts'
    WHEN 'pos_fixed_expenses' THEN 'manage_finance'
    WHEN 'pos_fixed_expense_payments' THEN 'manage_finance'
    WHEN 'pos_supplier_payments' THEN 'manage_finance'
    WHEN 'pos_fiscal_credit_notes' THEN 'issue_invoices'
    ELSE NULL
  END;

  IF v_capability IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_account := OLD.account_id;
  ELSE
    v_account := NEW.account_id;
  END IF;

  PERFORM pos_require_for(v_account, v_capability);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY[
    'pos_sale_returns',
    'pos_sale_return_items',
    'pos_inventory_docs',
    'pos_inventory_doc_items',
    'pos_shifts',
    'pos_fixed_expenses',
    'pos_fixed_expense_payments',
    'pos_supplier_payments',
    'pos_fiscal_credit_notes'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS guard_capability_%I ON %I', t, t
    );
    EXECUTE format(
      'CREATE TRIGGER guard_capability_%I '
      'BEFORE INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION pos_guard_table_capability()',
      t, t
    );
  END LOOP;
END $$;

-- Los movimientos de caja se validan por categoría: una venta no
-- debe exigir permiso de finanzas, pero un gasto sí.
CREATE OR REPLACE FUNCTION pos_guard_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capability TEXT;
BEGIN
  v_capability := CASE NEW.category
    WHEN 'sale' THEN 'sell'
    WHEN 'collection' THEN 'collect_credit'
    WHEN 'refund' THEN 'issue_returns'
    WHEN 'purchase' THEN 'manage_inventory'
    WHEN 'adjustment' THEN 'manage_inventory'
    ELSE 'manage_finance'
  END;

  PERFORM pos_require_for(NEW.account_id, v_capability);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_transaction_capability ON pos_transactions;
CREATE TRIGGER guard_transaction_capability
  BEFORE INSERT ON pos_transactions
  FOR EACH ROW EXECUTE FUNCTION pos_guard_transaction();

-- ------------------------------------------------------------
-- 9. RLS restrictiva para escrituras directas del navegador
-- ------------------------------------------------------------
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('pos_settings', 'manage_settings'),
      ('pos_fiscal_settings', 'manage_settings'),
      ('exchange_rates', 'manage_settings'),
      ('pos_categories', 'manage_catalog'),
      ('pos_products', 'manage_catalog'),
      ('pos_discounts', 'manage_catalog'),
      ('pos_surcharges', 'manage_catalog'),
      ('pos_price_lists', 'manage_catalog'),
      ('pos_product_prices', 'manage_catalog'),
      ('pos_sale_channels', 'manage_catalog'),
      ('pos_customers', 'manage_customers'),
      ('pos_inventory_docs', 'manage_inventory'),
      ('pos_inventory_doc_items', 'manage_inventory'),
      ('pos_inventory_movements', 'manage_inventory'),
      ('pos_accounts', 'manage_finance'),
      ('pos_transactions', 'manage_finance'),
      ('pos_fixed_expenses', 'manage_finance'),
      ('pos_fixed_expense_payments', 'manage_finance'),
      ('pos_supplier_payments', 'manage_finance'),
      ('pos_shifts', 'manage_shifts'),
      ('pos_registers', 'manage_shifts'),
      ('pos_sales', 'sell'),
      ('pos_sale_items', 'sell'),
      ('pos_sale_payments', 'sell')
    ) AS v(tbl, cap)
  LOOP
    IF to_regclass('public.' || rec.tbl) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I', rec.tbl || '_cap_insert', rec.tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT '
      'WITH CHECK (pos_can_for(account_id, %L))',
      rec.tbl || '_cap_insert', rec.tbl, rec.cap
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I', rec.tbl || '_cap_update', rec.tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE '
      'USING (pos_can_for(account_id, %L)) '
      'WITH CHECK (pos_can_for(account_id, %L))',
      rec.tbl || '_cap_update', rec.tbl, rec.cap, rec.cap
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I', rec.tbl || '_cap_delete', rec.tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE '
      'USING (pos_can_for(account_id, %L))',
      rec.tbl || '_cap_delete', rec.tbl, rec.cap
    );
  END LOOP;
END $$;

-- pos_settings era admin-only. Se reemplaza por la capacidad para
-- que una concesión explícita a un agente también funcione.
DROP POLICY IF EXISTS pos_settings_write ON pos_settings;
CREATE POLICY pos_settings_write ON pos_settings
  FOR ALL USING (pos_can_for(account_id, 'manage_settings'))
  WITH CHECK (pos_can_for(account_id, 'manage_settings'));

-- ------------------------------------------------------------
-- 10. Cobro con cliente del POS y límite de crédito
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_sale_checkout(
  p_items JSONB,
  p_payments JSONB DEFAULT '[]'::jsonb,
  p_pos_customer_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_rate NUMERIC DEFAULT 0,
  p_discount_code TEXT DEFAULT NULL,
  p_surcharges JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_account UUID;
  v_result JSONB;
  v_sale UUID;
  v_balance NUMERIC;
  v_customer_id UUID;
  v_debt NUMERIC := 0;
  v_available NUMERIC;
  v_limit NUMERIC;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT account_id INTO v_account
    FROM profiles
   WHERE user_id = v_user
   LIMIT 1;

  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  PERFORM pos_require_for(v_account, 'sell');

  IF p_pos_customer_id IS NOT NULL THEN
    SELECT id, credit_limit_usd
      INTO v_customer_id, v_limit
      FROM pos_customers
     WHERE id = p_pos_customer_id
       AND account_id = v_account
       AND active;

    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'Cliente del POS no válido';
    END IF;
  END IF;

  -- Se conserva la RPC existente: aquí solo se añade el cliente del
  -- POS y las reglas de crédito. Así no se duplica el motor de ventas.
  v_result := pos_create_sale(
    p_items,
    p_payments,
    NULL,
    p_notes,
    p_rate,
    p_discount_code,
    p_surcharges
  );

  v_sale := (v_result ->> 'sale_id')::UUID;
  v_balance := COALESCE((v_result ->> 'balance_usd')::NUMERIC, 0);

  IF p_pos_customer_id IS NOT NULL THEN
    SELECT COALESCE(SUM(balance_usd), 0) INTO v_debt
      FROM pos_sales
     WHERE account_id = v_account
       AND pos_customer_id = p_pos_customer_id
       AND status = 'credit'
       AND id <> v_sale;
  END IF;

  IF v_balance > 0.005 THEN
    PERFORM pos_require_for(v_account, 'sell_credit');

    IF p_pos_customer_id IS NULL THEN
      RAISE EXCEPTION 'La venta a crédito requiere un cliente del POS';
    END IF;

    IF v_limit IS NOT NULL
       AND v_debt + v_balance > v_limit + 0.005 THEN
      v_available := GREATEST(ROUND(v_limit - v_debt, 2), 0);
      RAISE EXCEPTION
        'El cliente supera su límite de crédito. Límite: %, saldo usado: %, esta venta: %, disponible: %',
        v_limit,
        ROUND(v_debt, 2),
        ROUND(v_balance, 2),
        v_available;
    END IF;
  END IF;

  UPDATE pos_sales
     SET pos_customer_id = p_pos_customer_id
   WHERE id = v_sale;

  RETURN v_result || jsonb_build_object(
    'pos_customer_id', p_pos_customer_id,
    'credit_limit_usd', v_limit,
    'customer_debt_usd', ROUND(v_debt + v_balance, 2)
  );
END;
$$;

-- ------------------------------------------------------------
-- 11. Permisos de ejecución
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION pos_capability_keys() TO authenticated;
GRANT EXECUTE ON FUNCTION pos_capability_label(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_default_permission(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_can_for(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_can(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_require_for(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_my_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION pos_set_permission(UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_reset_user_permissions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_audit_logs(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_sale_checkout(
  JSONB, JSONB, UUID, TEXT, NUMERIC, TEXT, JSONB
) TO authenticated;

NOTIFY pgrst, 'reload schema';
