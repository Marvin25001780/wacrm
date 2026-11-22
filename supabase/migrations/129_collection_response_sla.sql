-- ============================================================
-- 129_collection_response_sla.sql - SLA de primera respuesta
--
-- La 128 ya sabe QUIEN espera respuesta por WhatsApp. Lo que no
-- dice es CUANTO lleva esperando. Sin ese dato, "Esperan
-- respuesta: 8" no permite priorizar ni supervisar: puede haber
-- un caso de hace 4 minutos y otro de hace 3 dias.
--
-- Esta migracion agrega:
--
--   1. collection_settings.response_sla_minutes (1..1440, 30 por
--      defecto): el compromiso del negocio para contestar el
--      primer mensaje. Se edita en Configuracion de cobranza.
--   2. collection_agent_queue().waiting_minutes: minutos desde el
--      ultimo entrante del deudor, calculados en el servidor.
--      NULL cuando no espera respuesta.
--   3. collection_awaiting_replies(): oldest_inbound_at y
--      over_sla por gestor, para que el supervisor vea el caso
--      mas viejo y cuantos rompen el SLA.
--
-- No se guarda ningun contador: el tiempo se deriva de
-- messages.created_at, igual que la senal de la 128. Un mensaje
-- del negocio apaga la espera y el reloj desaparece solo.
--
-- Ambas funciones cambian su tipo de retorno, por eso se hace
-- DROP + CREATE y se re-aplican los grants al final.
-- ============================================================

-- ============================================================
-- 1. SLA configurable por negocio
-- ============================================================
ALTER TABLE public.collection_settings
  ADD COLUMN IF NOT EXISTS response_sla_minutes INT NOT NULL DEFAULT 30;

ALTER TABLE public.collection_settings
  DROP CONSTRAINT IF EXISTS collection_settings_response_sla_check;
ALTER TABLE public.collection_settings
  ADD CONSTRAINT collection_settings_response_sla_check
  CHECK (response_sla_minutes BETWEEN 1 AND 1440);

COMMENT ON COLUMN public.collection_settings.response_sla_minutes IS
  'Minutos maximos para contestar el primer mensaje de un deudor. 30 por defecto.';

-- ============================================================
-- 2. Cola del agente con el tiempo de espera
-- ============================================================
DROP FUNCTION IF EXISTS public.collection_agent_queue(
  UUID, TEXT, TEXT, TEXT, INT, INT
);

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
  awaiting_reply BOOLEAN,
  last_inbound_at TIMESTAMPTZ,
  waiting_minutes INTEGER,
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
  -- Ultimo entrante del deudor vs. ultimo mensaje del negocio en
  -- cualquiera de sus hilos de WhatsApp (128).
  wa AS (
    SELECT
      d.id AS debtor_id,
      MAX(m.created_at) FILTER (
        WHERE m.sender_type = 'customer'
      ) AS last_inbound_at,
      MAX(m.created_at) FILTER (
        WHERE m.sender_type <> 'customer'
      ) AS last_outbound_at
    FROM public.collection_debtors d
    JOIN public.conversations c
      ON c.account_id = d.account_id
     AND c.contact_id = d.contact_id
     AND c.channel = 'whatsapp'
    JOIN public.messages m ON m.conversation_id = c.id
    WHERE d.account_id = p_account_id
      AND d.contact_id IS NOT NULL
    GROUP BY d.id
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
      COALESCE(w.last_inbound_at > w.last_outbound_at, FALSE) AS awaiting_reply,
      w.last_inbound_at,
      CASE
        WHEN COALESCE(w.last_inbound_at > w.last_outbound_at, FALSE)
          THEN GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - w.last_inbound_at)) / 60)
          )::INTEGER
        ELSE NULL
      END AS waiting_minutes,
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
    LEFT JOIN wa w ON w.debtor_id = b.debtor_id
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
    j.awaiting_reply,
    j.last_inbound_at,
    j.waiting_minutes,
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
    j.awaiting_reply DESC,
    j.waiting_minutes DESC NULLS LAST,
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
-- 3. Respuestas pendientes con antiguedad y SLA por gestor
-- ============================================================
DROP FUNCTION IF EXISTS public.collection_awaiting_replies(UUID);

CREATE OR REPLACE FUNCTION public.collection_awaiting_replies(
  p_account_id UUID
)
RETURNS TABLE (
  agent_user_id UUID,
  agent_name TEXT,
  awaiting_count BIGINT,
  over_sla BIGINT,
  oldest_inbound_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_sla INT;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un supervisor puede ver las respuestas pendientes.'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.response_sla_minutes
    INTO v_sla
    FROM public.collection_settings s
   WHERE s.account_id = p_account_id;

  v_sla := COALESCE(v_sla, 30);

  RETURN QUERY
  WITH wa AS (
    SELECT
      d.id AS debtor_id,
      MAX(m.created_at) FILTER (
        WHERE m.sender_type = 'customer'
      ) AS last_inbound_at,
      MAX(m.created_at) FILTER (
        WHERE m.sender_type <> 'customer'
      ) AS last_outbound_at
    FROM public.collection_debtors d
    JOIN public.conversations c
      ON c.account_id = d.account_id
     AND c.contact_id = d.contact_id
     AND c.channel = 'whatsapp'
    JOIN public.messages m ON m.conversation_id = c.id
    WHERE d.account_id = p_account_id
      AND d.contact_id IS NOT NULL
    GROUP BY d.id
  ),
  pending AS (
    SELECT
      d.assigned_to,
      w.last_inbound_at,
      GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (NOW() - w.last_inbound_at)) / 60)
      )::INTEGER AS waiting_minutes
    FROM public.collection_debtors d
    JOIN wa w ON w.debtor_id = d.id
    WHERE d.account_id = p_account_id
      AND d.status <> 'pagado'
      AND COALESCE(w.last_inbound_at > w.last_outbound_at, FALSE)
  ),
  assigned AS (
    SELECT
      prof.user_id,
      COALESCE(
        NULLIF(btrim(am.display_name), ''),
        NULLIF(btrim(prof.full_name), ''),
        prof.email,
        'Sin nombre'
      )::TEXT AS name,
      COUNT(*)::BIGINT AS awaiting_count,
      COUNT(*) FILTER (
        WHERE p.waiting_minutes >= v_sla
      )::BIGINT AS over_sla,
      MIN(p.last_inbound_at) AS oldest_inbound_at
    FROM pending p
    JOIN public.profiles prof ON prof.id = p.assigned_to
    LEFT JOIN public.account_members am
      ON am.user_id = prof.user_id
     AND am.account_id = p_account_id
    GROUP BY prof.user_id, prof.full_name, prof.email, am.display_name
  ),
  unassigned AS (
    SELECT
      NULL::UUID AS user_id,
      'Sin asignar'::TEXT AS name,
      COUNT(*)::BIGINT AS awaiting_count,
      COUNT(*) FILTER (
        WHERE p.waiting_minutes >= v_sla
      )::BIGINT AS over_sla,
      MIN(p.last_inbound_at) AS oldest_inbound_at
    FROM pending p
    WHERE p.assigned_to IS NULL
  )
  SELECT
    rows.user_id,
    rows.name,
    rows.awaiting_count,
    rows.over_sla,
    rows.oldest_inbound_at
  FROM (
    SELECT * FROM assigned
    UNION ALL
    SELECT * FROM unassigned
  ) rows
  ORDER BY rows.awaiting_count DESC, rows.name ASC;
END;
$$;

-- ============================================================
-- 4. Permisos
-- ============================================================
REVOKE ALL ON FUNCTION public.collection_agent_queue(
  UUID, TEXT, TEXT, TEXT, INT, INT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_awaiting_replies(UUID) FROM PUBLIC;

ALTER FUNCTION public.collection_agent_queue(
  UUID, TEXT, TEXT, TEXT, INT, INT
) OWNER TO postgres;
ALTER FUNCTION public.collection_awaiting_replies(UUID) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.collection_agent_queue(
  UUID, TEXT, TEXT, TEXT, INT, INT
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_awaiting_replies(UUID)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   ALTER TABLE public.collection_settings
--     DROP CONSTRAINT IF EXISTS collection_settings_response_sla_check;
--   ALTER TABLE public.collection_settings
--     DROP COLUMN IF EXISTS response_sla_minutes;
--   DROP FUNCTION IF EXISTS public.collection_awaiting_replies(UUID);
--   DROP FUNCTION IF EXISTS public.collection_agent_queue(
--     UUID, TEXT, TEXT, TEXT, INT, INT
--   );
--   -- Volver a crear ambas funciones desde la migracion 128
--   -- (sin waiting_minutes, over_sla ni oldest_inbound_at).
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
