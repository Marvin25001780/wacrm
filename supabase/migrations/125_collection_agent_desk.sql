-- ============================================================
-- 125_collection_agent_desk.sql — consola del agente de cobranza
--
-- El módulo de cobranza (073-079) tenía el modelo completo pero al
-- agente le faltaba la mesa de trabajo: no había forma de registrar
-- una gestión desde la interfaz, ni de tomar un deudor, ni de ver la
-- cola ordenada por riesgo. Esta migración cierra ese hueco.
--
-- Crea / corrige:
--   1. collection_settings.knowledge_base_url  (wiki de guiones —
--      Docmost u otro servicio, se abre como enlace externo)
--   2. collection_actions.call_session_id      (liga gestión ↔ llamada)
--   3. call_sessions.collection_debtor_id      (liga llamada ↔ deudor)
--   4. v_collection_debtor_summary             (corrige el saldo
--      multiplicado por el número de gestiones)
--   5. collection_agent_queue()                (cola del agente,
--      ordenada por riesgo y paginada)
--   6. collection_claim_debtor() / collection_release_debtor()
--   7. collection_record_action()              (gestión + PTP en una
--      sola transacción; si algo falla no queda promesa huérfana)
--
-- Reglas de la cola (transparentes, sin ML):
--   rank 0  promesa rota en los últimos 30 días o PTP que vence hoy
--   rank 1  PTP abierta que vence después
--   rank 2  mora (cuota vencida sin pagar)
--   rank 3  al día
-- Dentro de cada grupo: prioridad (076) → saldo vencido → mora →
-- nunca contactado primero.
--
-- Reclamar es atómico: `SELECT ... FOR UPDATE` sobre el deudor. Si
-- otro gestor ya lo tiene, la función falla con un mensaje claro en
-- vez de pisarlo.
--
-- Requiere 073, 074, 076, 110, 112. Idempotente.
-- ============================================================

-- ============================================================
-- 1. Enlace a la base de conocimiento (Docmost u otro)
-- ============================================================

ALTER TABLE public.collection_settings
  ADD COLUMN IF NOT EXISTS knowledge_base_url TEXT;

-- ============================================================
-- 2. Gestión ↔ llamada
-- ============================================================

ALTER TABLE public.collection_actions
  ADD COLUMN IF NOT EXISTS call_session_id UUID
    REFERENCES public.call_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_collection_actions_call
  ON public.collection_actions(call_session_id)
  WHERE call_session_id IS NOT NULL;

-- ============================================================
-- 3. Llamada ↔ deudor
--
-- Permite que una saliente marcada desde la consola quede ligada al
-- deudor: el agente la ve en el historial y la gestión puede tomar
-- la duración real de la llamada.
-- ============================================================

ALTER TABLE public.call_sessions
  ADD COLUMN IF NOT EXISTS collection_debtor_id UUID
    REFERENCES public.collection_debtors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_call_sessions_collection_debtor
  ON public.call_sessions(collection_debtor_id)
  WHERE collection_debtor_id IS NOT NULL;

-- ============================================================
-- 4. Vista resumida del deudor (corrección)
--
-- La versión de 076 unía cuotas y gestiones en el mismo FROM: con N
-- gestiones, cada cuota se contaba N veces y el saldo salía
-- multiplicado. Aquí cada agregado va en su propio LATERAL.
-- Columnas y orden idénticos para no romper a quien la consume.
-- ============================================================

CREATE OR REPLACE VIEW public.v_collection_debtor_summary
WITH (security_invoker = true) AS
SELECT
  d.id,
  d.account_id,
  d.portfolio_id,
  d.name,
  d.document_number,
  d.phone_primary,
  d.email,
  d.segment,
  d.status,
  d.assigned_to,
  d.priority_score,
  d.priority_reason,
  d.created_at,
  d.updated_at,
  COALESCE(i.open_installments, 0) AS open_installments,
  COALESCE(i.balance, 0) AS balance,
  COALESCE(i.overdue_balance, 0) AS overdue_balance,
  COALESCE(i.days_overdue_max, 0) AS days_overdue_max,
  a.last_action_at
FROM public.collection_debtors d
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE i.status IN ('pending', 'partial')) AS open_installments,
    COALESCE(SUM(i.total - i.paid_amount) FILTER (
      WHERE i.status IN ('pending', 'partial')
    ), 0) AS balance,
    COALESCE(SUM(i.total - i.paid_amount) FILTER (
      WHERE i.status IN ('pending', 'partial') AND i.due_date < CURRENT_DATE
    ), 0) AS overdue_balance,
    COALESCE(MAX(CURRENT_DATE - i.due_date) FILTER (
      WHERE i.status IN ('pending', 'partial') AND i.due_date < CURRENT_DATE
    ), 0) AS days_overdue_max
  FROM public.collection_installments i
  WHERE i.debtor_id = d.id
) i ON TRUE
LEFT JOIN LATERAL (
  SELECT MAX(a.created_at) AS last_action_at
  FROM public.collection_actions a
  WHERE a.debtor_id = d.id
) a ON TRUE;

-- ============================================================
-- 5. Cola del agente
--
-- SECURITY DEFINER porque necesita el nombre del gestor
-- (`profiles` solo deja ver el perfil propio por RLS). La
-- pertenencia al negocio se valida explícitamente antes de leer.
-- ============================================================

CREATE OR REPLACE FUNCTION public.collection_agent_queue(
  p_account_id UUID,
  p_scope TEXT DEFAULT 'mine',
  p_search TEXT DEFAULT NULL,
  p_segment TEXT DEFAULT NULL,
  p_limit INT DEFAULT 30,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  debtor_id UUID,
  name TEXT,
  document_number TEXT,
  phone_primary TEXT,
  email TEXT,
  segment TEXT,
  status TEXT,
  priority_score NUMERIC,
  priority_reason TEXT,
  assigned_to UUID,
  agent_name TEXT,
  is_mine BOOLEAN,
  balance NUMERIC,
  overdue_balance NUMERIC,
  days_overdue_max INTEGER,
  open_installments BIGINT,
  last_action_at TIMESTAMPTZ,
  last_level1 TEXT,
  last_level2 TEXT,
  open_promises BIGINT,
  next_promise_due DATE,
  broken_promises BIGINT,
  queue_rank SMALLINT,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_scope TEXT;
  v_limit INT;
  v_offset INT;
  v_search TEXT;
  v_segment TEXT;
BEGIN
  IF NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  v_scope := lower(COALESCE(p_scope, 'mine'));
  IF v_scope NOT IN ('mine', 'unassigned', 'all') THEN
    v_scope := 'mine';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));
  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_search := left(v_search, 60);
  v_segment := NULLIF(btrim(COALESCE(p_segment, '')), '');
  IF v_segment IS NOT NULL AND v_segment NOT IN (
    'preventiva', 'temprana', 'media', 'tardia', 'critica'
  ) THEN
    v_segment := NULL;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      d.id AS debtor_id,
      d.name::TEXT AS name,
      d.document_number::TEXT AS document_number,
      d.phone_primary::TEXT AS phone_primary,
      d.email::TEXT AS email,
      d.segment::TEXT AS segment,
      d.status::TEXT AS status,
      d.priority_score,
      d.priority_reason::TEXT AS priority_reason,
      d.assigned_to,
      COALESCE(s.balance, 0) AS balance,
      COALESCE(s.overdue_balance, 0) AS overdue_balance,
      COALESCE(s.days_overdue_max, 0)::INTEGER AS days_overdue_max,
      COALESCE(s.open_installments, 0) AS open_installments,
      s.last_action_at
    FROM public.collection_debtors d
    LEFT JOIN public.v_collection_debtor_summary s ON s.id = d.id
    WHERE d.account_id = p_account_id
      AND d.status <> 'pagado'
      AND (v_segment IS NULL OR d.segment = v_segment)
  ),
  prom AS (
    SELECT
      p.debtor_id,
      COUNT(*) FILTER (WHERE p.status IN ('pending', 'partial')) AS open_promises,
      MIN(p.due_date) FILTER (WHERE p.status IN ('pending', 'partial')) AS next_promise_due,
      COUNT(*) FILTER (
        WHERE p.status = 'broken'
          AND p.resolved_at >= NOW() - INTERVAL '30 days'
      ) AS broken_promises
    FROM public.collection_promises p
    WHERE p.account_id = p_account_id
    GROUP BY p.debtor_id
  ),
  last_action AS (
    SELECT DISTINCT ON (a.debtor_id)
      a.debtor_id,
      a.level1_code::TEXT AS level1_code,
      a.level2_code::TEXT AS level2_code
    FROM public.collection_actions a
    WHERE a.account_id = p_account_id
    ORDER BY a.debtor_id, a.created_at DESC
  ),
  joined AS (
    SELECT
      b.*,
      COALESCE(pr.open_promises, 0) AS open_promises,
      pr.next_promise_due,
      COALESCE(pr.broken_promises, 0) AS broken_promises,
      la.level1_code AS last_level1,
      la.level2_code AS last_level2,
      prof.user_id AS agent_user_id,
      COALESCE(
        NULLIF(btrim(am.display_name), ''),
        NULLIF(btrim(prof.full_name), ''),
        prof.email
      )::TEXT AS agent_name,
      CASE
        WHEN COALESCE(pr.broken_promises, 0) > 0
          OR (pr.next_promise_due IS NOT NULL AND pr.next_promise_due <= CURRENT_DATE)
          THEN 0
        WHEN pr.next_promise_due IS NOT NULL THEN 1
        WHEN COALESCE(b.days_overdue_max, 0) > 0 THEN 2
        ELSE 3
      END::SMALLINT AS queue_rank
    FROM base b
    LEFT JOIN prom pr ON pr.debtor_id = b.debtor_id
    LEFT JOIN last_action la ON la.debtor_id = b.debtor_id
    LEFT JOIN public.profiles prof ON prof.id = b.assigned_to
    LEFT JOIN public.account_members am
      ON am.user_id = prof.user_id
     AND am.account_id = p_account_id
  )
  SELECT
    j.debtor_id,
    j.name,
    j.document_number,
    j.phone_primary,
    j.email,
    j.segment,
    j.status,
    j.priority_score,
    j.priority_reason,
    j.assigned_to,
    j.agent_name,
    COALESCE(j.agent_user_id = auth.uid(), FALSE) AS is_mine,
    j.balance,
    j.overdue_balance,
    j.days_overdue_max,
    j.open_installments,
    j.last_action_at,
    j.last_level1,
    j.last_level2,
    j.open_promises,
    j.next_promise_due,
    j.broken_promises,
    j.queue_rank,
    COUNT(*) OVER () AS total_count
  FROM joined j
  WHERE (
      v_scope = 'all'
      OR (v_scope = 'mine' AND j.agent_user_id = auth.uid())
      OR (v_scope = 'unassigned' AND j.assigned_to IS NULL)
    )
    AND (
      v_search IS NULL
      OR j.name ILIKE '%' || v_search || '%'
      OR COALESCE(j.document_number, '') ILIKE '%' || v_search || '%'
      OR COALESCE(j.phone_primary, '') ILIKE '%' || v_search || '%'
    )
  ORDER BY
    j.queue_rank ASC,
    j.priority_score DESC,
    j.overdue_balance DESC,
    j.days_overdue_max DESC,
    j.last_action_at ASC NULLS FIRST,
    j.name ASC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

-- ============================================================
-- 6. Tomar / soltar un deudor
-- ============================================================

CREATE OR REPLACE FUNCTION public.collection_claim_debtor(
  p_debtor_id UUID
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
  v_assigned UUID;
  v_me UUID;
  v_other_name TEXT;
BEGIN
  SELECT d.account_id, d.assigned_to
    INTO v_account, v_assigned
    FROM public.collection_debtors d
   WHERE d.id = p_debtor_id
   FOR UPDATE;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'El deudor no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  SELECT p.id INTO v_me
    FROM public.profiles p
   WHERE p.user_id = auth.uid();

  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Tu perfil no está configurado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_assigned IS NOT NULL
     AND v_assigned <> v_me
     AND NOT is_account_member(v_account, 'admin') THEN
    SELECT COALESCE(
             NULLIF(btrim(am.display_name), ''),
             NULLIF(btrim(p.full_name), ''),
             p.email,
             'Otro gestor'
           )
      INTO v_other_name
      FROM public.profiles p
      LEFT JOIN public.account_members am
        ON am.user_id = p.user_id AND am.account_id = v_account
     WHERE p.id = v_assigned;

    RAISE EXCEPTION 'Este deudor ya lo tomó %.', COALESCE(v_other_name, 'otro gestor')
      USING ERRCODE = 'P0001';
  END IF;

  -- Si un admin lo toma, la asignación anterior se cierra.
  UPDATE public.collection_assignments
     SET status = 'reassigned'
   WHERE debtor_id = p_debtor_id
     AND status = 'active'
     AND user_id <> v_me;

  INSERT INTO public.collection_assignments (
    account_id, debtor_id, user_id, queue, priority_score, reason
  )
  SELECT v_account, d.id, v_me, 'general', d.priority_score,
         'Tomado desde la consola de cobranza'
    FROM public.collection_debtors d
   WHERE d.id = p_debtor_id
  ON CONFLICT DO NOTHING;

  UPDATE public.collection_debtors
     SET assigned_to = v_me,
         updated_at = NOW()
   WHERE id = p_debtor_id;

  RETURN QUERY
  SELECT d.id,
         d.assigned_to,
         p.user_id,
         COALESCE(
           NULLIF(btrim(am.display_name), ''),
           NULLIF(btrim(p.full_name), ''),
           p.email
         )::TEXT
    FROM public.collection_debtors d
    JOIN public.profiles p ON p.id = d.assigned_to
    LEFT JOIN public.account_members am
      ON am.user_id = p.user_id AND am.account_id = v_account
   WHERE d.id = p_debtor_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.collection_release_debtor(
  p_debtor_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_assigned UUID;
  v_me UUID;
  v_count INT;
BEGIN
  SELECT d.account_id, d.assigned_to
    INTO v_account, v_assigned
    FROM public.collection_debtors d
   WHERE d.id = p_debtor_id
   FOR UPDATE;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'El deudor no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  SELECT p.id INTO v_me
    FROM public.profiles p
   WHERE p.user_id = auth.uid();

  IF v_assigned IS DISTINCT FROM v_me
     AND NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'Solo el gestor asignado (o un admin) puede soltarlo.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.collection_assignments
     SET status = 'reassigned'
   WHERE debtor_id = p_debtor_id
     AND status = 'active';

  UPDATE public.collection_debtors
     SET assigned_to = NULL,
         updated_at = NOW()
   WHERE id = p_debtor_id
     AND assigned_to IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- ============================================================
-- 7. Registrar la gestión (atómica)
--
-- Una gestión puede crear una PTP en el mismo paso. Hacerlo en dos
-- INSERT desde la API dejaba una promesa huérfana si el segundo
-- fallaba (y el agente no puede borrar filas: la RLS de borrado es
-- de admin). Aquí todo ocurre en una transacción.
--
-- La validación "amable" (mensajes antes de escribir) vive en
-- `src/lib/collections/desk.ts`; esta función es la última barrera.
-- ============================================================

CREATE OR REPLACE FUNCTION public.collection_record_action(
  p_debtor_id UUID,
  p_level1 TEXT,
  p_level2 TEXT DEFAULT NULL,
  p_channel TEXT DEFAULT 'call',
  p_direction TEXT DEFAULT 'outbound',
  p_notes TEXT DEFAULT NULL,
  p_credit_id UUID DEFAULT NULL,
  p_installment_id UUID DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_debtor_status TEXT DEFAULT NULL,
  p_call_session_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_credit UUID;
  v_action UUID;
  v_promise UUID;
  v_channel TEXT;
  v_direction TEXT;
  v_status TEXT;
  v_allowed TEXT[];
  v_call public.call_sessions;
BEGIN
  SELECT d.account_id INTO v_account
    FROM public.collection_debtors d
   WHERE d.id = p_debtor_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'El deudor no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  v_channel := lower(COALESCE(p_channel, 'call'));
  IF v_channel NOT IN ('call', 'whatsapp', 'sms', 'email', 'visit', 'other') THEN
    v_channel := 'other';
  END IF;

  v_direction := lower(COALESCE(p_direction, 'outbound'));
  IF v_direction NOT IN ('outbound', 'inbound') THEN
    v_direction := 'outbound';
  END IF;

  IF p_debtor_status IS NOT NULL AND btrim(p_debtor_status) <> '' THEN
    v_status := lower(btrim(p_debtor_status));
    IF is_account_member(v_account, 'admin') THEN
      v_allowed := ARRAY['contactado', 'negociacion', 'acuerdo', 'ilocalizable', 'juridico'];
    ELSE
      v_allowed := ARRAY['contactado', 'negociacion', 'acuerdo', 'ilocalizable'];
    END IF;
    IF NOT (v_status = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'Estado de deudor no permitido: %', p_debtor_status
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_credit_id IS NOT NULL THEN
    SELECT c.id INTO v_credit
      FROM public.collection_credits c
     WHERE c.id = p_credit_id
       AND c.debtor_id = p_debtor_id;
    IF v_credit IS NULL THEN
      RAISE EXCEPTION 'El crédito no pertenece a este deudor.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_installment_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.collection_installments i
       WHERE i.id = p_installment_id
         AND i.debtor_id = p_debtor_id
    ) THEN
      RAISE EXCEPTION 'La cuota no pertenece a este deudor.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Vincular una llamada exige que sea del negocio y del propio agente
  -- (un admin puede auditar y vincular cualquiera).
  IF p_call_session_id IS NOT NULL THEN
    SELECT * INTO v_call
      FROM public.call_sessions s
     WHERE s.id = p_call_session_id
       AND s.account_id = v_account;

    IF v_call.id IS NULL THEN
      RAISE EXCEPTION 'La llamada no pertenece a este negocio.' USING ERRCODE = 'P0001';
    END IF;
    IF v_call.agent_user_id IS DISTINCT FROM auth.uid()
       AND NOT is_account_member(v_account, 'admin') THEN
      RAISE EXCEPTION 'Solo puedes vincular tus propias llamadas.' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.collection_actions (
    account_id, debtor_id, credit_id, installment_id, user_id,
    channel, direction, level1_code, level2_code, notes,
    call_duration_seconds, started_at, ended_at, call_session_id
  ) VALUES (
    v_account, p_debtor_id, v_credit, p_installment_id, auth.uid(),
    v_channel, v_direction, p_level1, NULLIF(btrim(p_level2), ''),
    left(p_notes, 2000),
    v_call.duration_seconds, v_call.started_at, v_call.ended_at,
    p_call_session_id
  ) RETURNING id INTO v_action;

  IF NULLIF(btrim(p_level2), '') = 'ptp' THEN
    IF v_credit IS NULL THEN
      RAISE EXCEPTION 'La promesa de pago necesita un crédito.' USING ERRCODE = 'P0001';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'El monto de la promesa debe ser mayor que cero.' USING ERRCODE = 'P0001';
    END IF;
    IF p_due_date IS NULL THEN
      RAISE EXCEPTION 'La promesa de pago necesita una fecha.' USING ERRCODE = 'P0001';
    END IF;
    IF p_due_date < CURRENT_DATE THEN
      RAISE EXCEPTION 'La fecha de la promesa no puede estar en el pasado.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.collection_promises (
      account_id, debtor_id, credit_id, action_id, amount, due_date,
      channel, notes, created_by
    ) VALUES (
      v_account, p_debtor_id, v_credit, v_action, p_amount, p_due_date,
      v_channel, left(p_notes, 2000), auth.uid()
    ) RETURNING id INTO v_promise;

    UPDATE public.collection_actions
       SET promise_id = v_promise
     WHERE id = v_action;
  END IF;

  IF v_status IS NOT NULL THEN
    UPDATE public.collection_debtors
       SET status = v_status,
           updated_at = NOW()
     WHERE id = p_debtor_id;
  END IF;

  RETURN jsonb_build_object(
    'action_id', v_action,
    'promise_id', v_promise,
    'debtor_status', v_status
  );
END;
$$;

-- ============================================================
-- 8. Permisos
-- ============================================================

REVOKE ALL ON FUNCTION public.collection_agent_queue(UUID, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_claim_debtor(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_release_debtor(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_record_action(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, NUMERIC, DATE, TEXT, UUID
) FROM PUBLIC;

ALTER FUNCTION public.collection_agent_queue(UUID, TEXT, TEXT, TEXT, INT, INT) OWNER TO postgres;
ALTER FUNCTION public.collection_claim_debtor(UUID) OWNER TO postgres;
ALTER FUNCTION public.collection_release_debtor(UUID) OWNER TO postgres;
ALTER FUNCTION public.collection_record_action(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, NUMERIC, DATE, TEXT, UUID
) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.collection_agent_queue(UUID, TEXT, TEXT, TEXT, INT, INT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_claim_debtor(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_release_debtor(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_record_action(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, NUMERIC, DATE, TEXT, UUID
) TO authenticated, service_role;

GRANT SELECT ON public.v_collection_debtor_summary TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   DROP FUNCTION IF EXISTS public.collection_record_action(
--     UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, NUMERIC, DATE, TEXT, UUID);
--   DROP FUNCTION IF EXISTS public.collection_release_debtor(UUID);
--   DROP FUNCTION IF EXISTS public.collection_claim_debtor(UUID);
--   DROP FUNCTION IF EXISTS public.collection_agent_queue(UUID, TEXT, TEXT, TEXT, INT, INT);
--   -- (la vista se puede dejar: solo corrige el cálculo)
--   DROP INDEX IF EXISTS public.idx_call_sessions_collection_debtor;
--   ALTER TABLE public.call_sessions DROP COLUMN IF EXISTS collection_debtor_id;
--   DROP INDEX IF EXISTS public.idx_collection_actions_call;
--   ALTER TABLE public.collection_actions DROP COLUMN IF EXISTS call_session_id;
--   ALTER TABLE public.collection_settings DROP COLUMN IF EXISTS knowledge_base_url;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
