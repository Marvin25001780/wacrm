-- ============================================================
-- 126_collection_supervision.sql — supervisión de cobranza
--
-- La consola (125) le dio al agente su mesa de trabajo. Al
-- supervisor le faltaba la suya: no podía ver quién está trabajando,
-- cuánto lleva cada gestor, qué promesas vencen hoy, ni repartir la
-- cartera sin asignar. Esta migración cierra ese hueco.
--
-- Crea:
--   1. collection_supervisor_board()        tablero por gestor
--   2. collection_supervisor_promises()     promesas por vencer (o vencidas)
--   3. collection_supervisor_totals()       cartera y reparto pendiente
--   4. collection_assign_debtor()           reasignar a un gestor concreto
--   5. collection_distribute_unassigned()   reparto automático por carga
--   6. collection_debtor_assignee()         nombre del gestor de un deudor
--
-- Decisiones:
--   * Todo lo administrativo exige `is_account_member(...,'admin')`;
--     `collection_debtor_assignee` solo exige `agent` porque la ficha
--     del deudor la abre cualquier gestor.
--   * "Hoy" se calcula con la zona horaria de
--     `collection_settings.timezone` (America/Caracas por defecto). Un
--     corte a medianoche UTC contaría mal las gestiones de la noche.
--   * El reparto automático solo usa miembros con rol `agent` y
--     ordena por carga actual: el que menos tiene recibe primero.
--     Es explícito (nunca toca deudores ya asignados) e idempotente:
--     correrlo dos veces no duplica nada.
--   * Las RPC son SECURITY DEFINER porque necesitan nombres de
--     `profiles`/`account_members` (la RLS solo deja ver el perfil
--     propio). La pertenencia al negocio se valida antes de leer.
--
-- Requiere 066, 073, 074, 076, 110, 112 y 125. Idempotente.
-- ============================================================

-- ============================================================
-- 0. Índice para el reparto de cartera sin asignar
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_collection_debtors_unassigned
  ON public.collection_debtors(account_id, priority_score DESC, created_at)
  WHERE assigned_to IS NULL;

-- ============================================================
-- 1. Tablero por gestor
--
-- Una fila por miembro operativo (agente, admin u owner). Los
-- viewers se excluyen porque no pueden gestionar cartera.
-- ============================================================

CREATE OR REPLACE FUNCTION public.collection_supervisor_board(
  p_account_id UUID
)
RETURNS TABLE (
  user_id UUID,
  profile_id UUID,
  name TEXT,
  role TEXT,
  assigned_count BIGINT,
  balance_assigned NUMERIC,
  overdue_assigned NUMERIC,
  actions_today BIGINT,
  contacts_today BIGINT,
  ptp_today BIGINT,
  promises_due_today BIGINT,
  promises_overdue BIGINT,
  broken_promises_30d BIGINT,
  last_action_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tz TEXT;
  v_today DATE;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un supervisor puede ver el tablero de cobranza.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(NULLIF(btrim(s.timezone), ''), 'America/Caracas')
    INTO v_tz
    FROM public.collection_settings s
   WHERE s.account_id = p_account_id;

  v_tz := COALESCE(v_tz, 'America/Caracas');
  BEGIN
    v_today := (NOW() AT TIME ZONE v_tz)::DATE;
  EXCEPTION WHEN OTHERS THEN
    -- Una zona mal escrita no debe tumbar el tablero.
    v_tz := 'America/Caracas';
    v_today := (NOW() AT TIME ZONE v_tz)::DATE;
  END;

  RETURN QUERY
  WITH members AS (
    SELECT
      m.user_id,
      p.id AS profile_id,
      m.role,
      COALESCE(
        NULLIF(btrim(m.display_name), ''),
        NULLIF(btrim(p.full_name), ''),
        p.email,
        'Sin nombre'
      )::TEXT AS name
    FROM public.account_members m
    LEFT JOIN public.profiles p ON p.user_id = m.user_id
    WHERE m.account_id = p_account_id
      AND m.role <> 'viewer'
  ),
  assigned AS (
    SELECT
      d.assigned_to AS profile_id,
      COUNT(*) AS assigned_count,
      COALESCE(SUM(s.balance), 0) AS balance_assigned,
      COALESCE(SUM(s.overdue_balance), 0) AS overdue_assigned
    FROM public.collection_debtors d
    LEFT JOIN public.v_collection_debtor_summary s ON s.id = d.id
    WHERE d.account_id = p_account_id
      AND d.status <> 'pagado'
      AND d.assigned_to IS NOT NULL
    GROUP BY d.assigned_to
  ),
  today_actions AS (
    SELECT
      a.user_id,
      COUNT(*) AS actions_today,
      COUNT(*) FILTER (
        WHERE a.level1_code IN ('contacted', 'third_party')
      ) AS contacts_today
    FROM public.collection_actions a
    WHERE a.account_id = p_account_id
      AND (a.created_at AT TIME ZONE v_tz)::DATE = v_today
    GROUP BY a.user_id
  ),
  today_ptp AS (
    SELECT
      pr.created_by AS user_id,
      COUNT(*) AS ptp_today
    FROM public.collection_promises pr
    WHERE pr.account_id = p_account_id
      AND pr.status <> 'cancelled'
      AND (pr.created_at AT TIME ZONE v_tz)::DATE = v_today
    GROUP BY pr.created_by
  ),
  portfolio_promises AS (
    SELECT
      d.assigned_to AS profile_id,
      COUNT(*) FILTER (
        WHERE pr.status IN ('pending', 'partial') AND pr.due_date = v_today
      ) AS promises_due_today,
      COUNT(*) FILTER (
        WHERE pr.status IN ('pending', 'partial') AND pr.due_date < v_today
      ) AS promises_overdue,
      COUNT(*) FILTER (
        WHERE pr.status = 'broken'
          AND COALESCE(pr.resolved_at, pr.updated_at) >= NOW() - INTERVAL '30 days'
      ) AS broken_promises_30d
    FROM public.collection_promises pr
    JOIN public.collection_debtors d ON d.id = pr.debtor_id
    WHERE pr.account_id = p_account_id
      AND d.assigned_to IS NOT NULL
    GROUP BY d.assigned_to
  ),
  last_action AS (
    SELECT a.user_id, MAX(a.created_at) AS last_action_at
    FROM public.collection_actions a
    WHERE a.account_id = p_account_id
    GROUP BY a.user_id
  )
  SELECT
    m.user_id,
    m.profile_id,
    m.name,
    m.role::TEXT,
    COALESCE(a.assigned_count, 0)::BIGINT,
    COALESCE(a.balance_assigned, 0),
    COALESCE(a.overdue_assigned, 0),
    COALESCE(ta.actions_today, 0)::BIGINT,
    COALESCE(ta.contacts_today, 0)::BIGINT,
    COALESCE(tp.ptp_today, 0)::BIGINT,
    COALESCE(pp.promises_due_today, 0)::BIGINT,
    COALESCE(pp.promises_overdue, 0)::BIGINT,
    COALESCE(pp.broken_promises_30d, 0)::BIGINT,
    la.last_action_at
  FROM members m
  LEFT JOIN assigned a ON a.profile_id = m.profile_id
  LEFT JOIN today_actions ta ON ta.user_id = m.user_id
  LEFT JOIN today_ptp tp ON tp.user_id = m.user_id
  LEFT JOIN portfolio_promises pp ON pp.profile_id = m.profile_id
  LEFT JOIN last_action la ON la.user_id = m.user_id
  ORDER BY
    CASE m.role WHEN 'agent' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
    COALESCE(ta.actions_today, 0) DESC,
    m.name ASC;
END;
$$;

-- ============================================================
-- 2. Promesas por vencer o vencidas
--
-- Devuelve solo PTP abiertas (pending/partial) hasta `p_days` días
-- adelante. Las vencidas entran siempre (`days_left` negativo), que
-- son justo las que el supervisor necesita ver primero.
-- ============================================================

CREATE OR REPLACE FUNCTION public.collection_supervisor_promises(
  p_account_id UUID,
  p_days INT DEFAULT 7,
  p_limit INT DEFAULT 100
)
RETURNS TABLE (
  promise_id UUID,
  debtor_id UUID,
  debtor_name TEXT,
  document_number TEXT,
  phone_primary TEXT,
  agent_user_id UUID,
  agent_name TEXT,
  amount NUMERIC,
  due_date DATE,
  status TEXT,
  days_left INT,
  credit_folio TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tz TEXT;
  v_today DATE;
  v_days INT;
  v_limit INT;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un supervisor puede ver las promesas del equipo.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(NULLIF(btrim(s.timezone), ''), 'America/Caracas')
    INTO v_tz
    FROM public.collection_settings s
   WHERE s.account_id = p_account_id;

  v_tz := COALESCE(v_tz, 'America/Caracas');
  BEGIN
    v_today := (NOW() AT TIME ZONE v_tz)::DATE;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'America/Caracas';
    v_today := (NOW() AT TIME ZONE v_tz)::DATE;
  END;

  v_days := GREATEST(0, LEAST(COALESCE(p_days, 7), 60));
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 100), 300));

  RETURN QUERY
  SELECT
    pr.id,
    d.id,
    d.name::TEXT,
    d.document_number::TEXT,
    d.phone_primary::TEXT,
    p.user_id,
    COALESCE(
      NULLIF(btrim(am.display_name), ''),
      NULLIF(btrim(p.full_name), ''),
      p.email,
      'Sin asignar'
    )::TEXT,
    pr.amount,
    pr.due_date,
    pr.status::TEXT,
    (pr.due_date - v_today)::INT,
    c.folio::TEXT
  FROM public.collection_promises pr
  JOIN public.collection_debtors d ON d.id = pr.debtor_id
  LEFT JOIN public.collection_credits c ON c.id = pr.credit_id
  LEFT JOIN public.profiles p ON p.id = d.assigned_to
  LEFT JOIN public.account_members am
    ON am.user_id = p.user_id
   AND am.account_id = p_account_id
  WHERE pr.account_id = p_account_id
    AND pr.status IN ('pending', 'partial')
    AND pr.due_date <= v_today + v_days
  ORDER BY pr.due_date ASC, pr.amount DESC, d.name ASC
  LIMIT v_limit;
END;
$$;

-- ============================================================
-- 3. Totales de la operación
-- ============================================================

CREATE OR REPLACE FUNCTION public.collection_supervisor_totals(
  p_account_id UUID
)
RETURNS TABLE (
  portfolio_size BIGINT,
  portfolio_balance NUMERIC,
  portfolio_overdue NUMERIC,
  unassigned_count BIGINT,
  unassigned_balance NUMERIC,
  assigned_count BIGINT,
  agents_total BIGINT,
  agents_with_portfolio BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_size BIGINT := 0;
  v_balance NUMERIC := 0;
  v_overdue NUMERIC := 0;
  v_unassigned BIGINT := 0;
  v_unassigned_balance NUMERIC := 0;
  v_assigned BIGINT := 0;
  v_agents BIGINT := 0;
  v_agents_with BIGINT := 0;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un supervisor puede ver los totales de cobranza.'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(s.balance), 0),
    COALESCE(SUM(s.overdue_balance), 0),
    COUNT(*) FILTER (WHERE s.assigned_to IS NULL),
    COALESCE(SUM(s.balance) FILTER (WHERE s.assigned_to IS NULL), 0),
    COUNT(*) FILTER (WHERE s.assigned_to IS NOT NULL)
  INTO v_size, v_balance, v_overdue, v_unassigned, v_unassigned_balance, v_assigned
  FROM public.v_collection_debtor_summary s
  WHERE s.account_id = p_account_id
    AND s.status <> 'pagado';

  SELECT
    COUNT(*) FILTER (WHERE m.role = 'agent'),
    COUNT(*) FILTER (
      WHERE m.role = 'agent'
        AND EXISTS (
          SELECT 1
          FROM public.collection_debtors d
          JOIN public.profiles p ON p.id = d.assigned_to
          WHERE d.account_id = p_account_id
            AND d.status <> 'pagado'
            AND p.user_id = m.user_id
        )
    )
  INTO v_agents, v_agents_with
  FROM public.account_members m
  WHERE m.account_id = p_account_id;

  RETURN QUERY
  SELECT
    v_size,
    v_balance,
    v_overdue,
    v_unassigned,
    v_unassigned_balance,
    v_assigned,
    v_agents,
    v_agents_with;
END;
$$;

-- ============================================================
-- 4. Asignar un deudor a un gestor concreto
--
-- Reemplaza la asignación activa anterior (si la había) en la misma
-- transacción. Un admin puede reasignar cartera de otro gestor; el
-- agente no puede hacerlo desde la consola (125 solo permite tomar
-- lo libre o lo suyo).
-- ============================================================

CREATE OR REPLACE FUNCTION public.collection_assign_debtor(
  p_debtor_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  debtor_id UUID,
  assigned_to UUID,
  agent_user_id UUID,
  agent_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_profile UUID;
  v_role account_role_enum;
  v_name TEXT;
BEGIN
  SELECT d.account_id
    INTO v_account
    FROM public.collection_debtors d
   WHERE d.id = p_debtor_id
   FOR UPDATE;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'El deudor no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'Solo un supervisor puede reasignar cartera.'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    m.role,
    p.id,
    COALESCE(
      NULLIF(btrim(m.display_name), ''),
      NULLIF(btrim(p.full_name), ''),
      p.email,
      'Sin nombre'
    )
  INTO v_role, v_profile, v_name
  FROM public.account_members m
  JOIN public.profiles p ON p.user_id = m.user_id
  WHERE m.account_id = v_account
    AND m.user_id = p_user_id;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'El usuario no pertenece a este negocio.' USING ERRCODE = 'P0001';
  END IF;
  IF v_role = 'viewer' THEN
    RAISE EXCEPTION 'No se puede asignar cartera a un usuario de solo lectura.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.collection_assignments
     SET status = 'reassigned'
   WHERE debtor_id = p_debtor_id
     AND status = 'active'
     AND user_id <> v_profile;

  INSERT INTO public.collection_assignments (
    account_id, debtor_id, user_id, queue, priority_score, reason
  )
  SELECT
    v_account, d.id, v_profile, 'general', d.priority_score,
    'Reasignado desde supervisión'
  FROM public.collection_debtors d
  WHERE d.id = p_debtor_id
  ON CONFLICT DO NOTHING;

  UPDATE public.collection_debtors
     SET assigned_to = v_profile,
         updated_at = NOW()
   WHERE id = p_debtor_id;

  RETURN QUERY
  SELECT d.id, d.assigned_to, p.user_id, v_name
  FROM public.collection_debtors d
  JOIN public.profiles p ON p.id = d.assigned_to
  WHERE d.id = p_debtor_id;
END;
$$;

-- ============================================================
-- 5. Repartir la cartera sin asignar
--
-- Solo toca deudores con `assigned_to IS NULL`. Ordena gestores por
-- carga actual (menos cartera primero) y entrega hasta `p_per_agent`
-- a cada uno. `FOR UPDATE SKIP LOCKED` evita que dos supervisores
-- repartiendo a la vez se pisen.
-- ============================================================

CREATE OR REPLACE FUNCTION public.collection_distribute_unassigned(
  p_account_id UUID,
  p_per_agent INT DEFAULT 10,
  p_segment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_per INT;
  v_segment TEXT;
  v_agent RECORD;
  v_debtor RECORD;
  v_rows INT;
  v_total INT := 0;
  v_agents INT := 0;
  v_breakdown JSONB := '[]'::JSONB;
  v_available_agents INT := 0;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un supervisor puede repartir cartera.'
      USING ERRCODE = '42501';
  END IF;

  v_per := GREATEST(1, LEAST(COALESCE(p_per_agent, 10), 50));
  v_segment := NULLIF(btrim(COALESCE(p_segment, '')), '');
  IF v_segment IS NOT NULL AND v_segment NOT IN (
    'preventiva', 'temprana', 'media', 'tardia', 'critica'
  ) THEN
    v_segment := NULL;
  END IF;

  SELECT COUNT(*)
    INTO v_available_agents
    FROM public.account_members m
   WHERE m.account_id = p_account_id
     AND m.role = 'agent';

  IF v_available_agents = 0 THEN
    RAISE EXCEPTION 'No hay gestores con rol agente en este negocio. Invita o cambia el rol antes de repartir.'
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_agent IN
    SELECT
      m.user_id,
      p.id AS profile_id,
      COALESCE(
        NULLIF(btrim(m.display_name), ''),
        NULLIF(btrim(p.full_name), ''),
        p.email,
        'Sin nombre'
      ) AS name
    FROM public.account_members m
    JOIN public.profiles p ON p.user_id = m.user_id
    WHERE m.account_id = p_account_id
      AND m.role = 'agent'
    ORDER BY (
      SELECT COUNT(*)
      FROM public.collection_debtors d
      WHERE d.account_id = p_account_id
        AND d.assigned_to = p.id
        AND d.status <> 'pagado'
    ) ASC, m.created_at ASC
  LOOP
    v_rows := 0;

    -- Se toma de a uno para que el bloqueo y la asignación ocurran en
    -- la misma transacción sin depender del orden de CTEs que mutan.
    FOR v_debtor IN
      SELECT d.id, d.priority_score
      FROM public.collection_debtors d
      WHERE d.account_id = p_account_id
        AND d.status <> 'pagado'
        AND d.assigned_to IS NULL
        AND (v_segment IS NULL OR d.segment = v_segment)
      ORDER BY d.priority_score DESC, d.created_at ASC
      LIMIT v_per
      FOR UPDATE SKIP LOCKED
    LOOP
      -- Por si quedó una asignación activa huérfana de un reparto
      -- anterior: se cierra antes de insertar la nueva.
      UPDATE public.collection_assignments
         SET status = 'reassigned'
       WHERE debtor_id = v_debtor.id
         AND status = 'active';

      UPDATE public.collection_debtors
         SET assigned_to = v_agent.profile_id,
             updated_at = NOW()
       WHERE id = v_debtor.id;

      INSERT INTO public.collection_assignments (
        account_id, debtor_id, user_id, queue, priority_score, reason
      ) VALUES (
        p_account_id, v_debtor.id, v_agent.profile_id, 'general',
        v_debtor.priority_score, 'Reparto automático desde supervisión'
      );

      v_rows := v_rows + 1;
    END LOOP;

    IF v_rows > 0 THEN
      v_total := v_total + v_rows;
      v_agents := v_agents + 1;
      v_breakdown := v_breakdown || jsonb_build_array(
        jsonb_build_object(
          'user_id', v_agent.user_id,
          'name', v_agent.name,
          'assigned', v_rows
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'assigned', v_total,
    'agents', v_agents,
    'per_agent', v_per,
    'segment', v_segment,
    'breakdown', v_breakdown
  );
END;
$$;

-- ============================================================
-- 6. ¿Quién tiene este deudor?
--
-- La ficha la abre cualquier gestor y necesita el nombre del
-- asignado. `profiles` solo deja ver el perfil propio por RLS, así
-- que se resuelve con una función acotada a un deudor concreto.
-- ============================================================

CREATE OR REPLACE FUNCTION public.collection_debtor_assignee(
  p_debtor_id UUID
)
RETURNS TABLE (
  profile_id UUID,
  user_id UUID,
  name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT d.account_id
    INTO v_account
    FROM public.collection_debtors d
   WHERE d.id = p_debtor_id;

  IF v_account IS NULL THEN
    RETURN;
  END IF;
  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.user_id,
    COALESCE(
      NULLIF(btrim(am.display_name), ''),
      NULLIF(btrim(p.full_name), ''),
      p.email,
      'Sin nombre'
    )::TEXT
  FROM public.collection_debtors d
  JOIN public.profiles p ON p.id = d.assigned_to
  LEFT JOIN public.account_members am
    ON am.user_id = p.user_id
   AND am.account_id = v_account
  WHERE d.id = p_debtor_id;
END;
$$;

-- ============================================================
-- 7. Permisos
-- ============================================================

REVOKE ALL ON FUNCTION public.collection_supervisor_board(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_supervisor_promises(UUID, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_supervisor_totals(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_assign_debtor(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_distribute_unassigned(UUID, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_debtor_assignee(UUID) FROM PUBLIC;

ALTER FUNCTION public.collection_supervisor_board(UUID) OWNER TO postgres;
ALTER FUNCTION public.collection_supervisor_promises(UUID, INT, INT) OWNER TO postgres;
ALTER FUNCTION public.collection_supervisor_totals(UUID) OWNER TO postgres;
ALTER FUNCTION public.collection_assign_debtor(UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.collection_distribute_unassigned(UUID, INT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.collection_debtor_assignee(UUID) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.collection_supervisor_board(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_supervisor_promises(UUID, INT, INT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_supervisor_totals(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_assign_debtor(UUID, UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_distribute_unassigned(UUID, INT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_debtor_assignee(UUID)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   DROP FUNCTION IF EXISTS public.collection_debtor_assignee(UUID);
--   DROP FUNCTION IF EXISTS public.collection_distribute_unassigned(UUID, INT, TEXT);
--   DROP FUNCTION IF EXISTS public.collection_assign_debtor(UUID, UUID);
--   DROP FUNCTION IF EXISTS public.collection_supervisor_totals(UUID);
--   DROP FUNCTION IF EXISTS public.collection_supervisor_promises(UUID, INT, INT);
--   DROP FUNCTION IF EXISTS public.collection_supervisor_board(UUID);
--   DROP INDEX IF EXISTS public.idx_collection_debtors_unassigned;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
