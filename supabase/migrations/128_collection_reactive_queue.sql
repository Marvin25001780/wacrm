-- ============================================================
-- 128_collection_reactive_queue.sql - cola reactiva de WhatsApp
--
-- El bloque 127 puso WhatsApp en la consola. El hueco que dejo es el
-- inverso: el deudor responde, el mensaje queda en `messages`, y la
-- cola no se entera. El agente solo lo ve si abre esa ficha por
-- casualidad.
--
-- Esta migracion hace que la cola mire el hilo:
--
--   awaiting_reply = el ultimo mensaje del deudor es mas nuevo que
--                    el ultimo mensaje del negocio en ese contacto.
--
-- No se usa conversations.unread_count porque el inbox lo limpia al
-- abrir el hilo y la consola no: el contador mentiria en ambos
-- sentidos. Se compara el hilo real de `messages`, asi que responder
-- desde la consola apaga la alerta sola, sin tablas de estado nuevas.
--
-- Reglas:
--   - solo cuentan hilos de WhatsApp del contacto vinculado al deudor
--     (collection_debtors.contact_id);
--   - "negocio" es cualquier mensaje que no sea del cliente
--     (agent o bot): un bot que responde tambien cierra la espera;
--   - un deudor sin contacto o sin mensajes nunca aparece como
--     "esperando";
--   - la cola ordena primero a quien espera respuesta y despues
--     mantiene el orden de siempre (PTP vencida, PTP proxima, mora).
--
-- El tablero del supervisor gana un RPC aparte con el conteo por
-- gestor, sin tocar la firma de collection_supervisor_board (126).
-- ============================================================

-- ============================================================
-- 1. Indice para resolver el hilo del contacto sin escanear
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_conversations_contact_whatsapp
  ON public.conversations (contact_id, account_id)
  WHERE channel = 'whatsapp';

-- ============================================================
-- 2. Cola del agente con la senal de respuesta
--
-- Se elimina y recrea porque cambia el tipo de retorno (dos columnas
-- nuevas). Los grants se vuelven a aplicar al final del bloque.
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
  -- cualquiera de sus hilos de WhatsApp. Si el entrante es mas nuevo,
  -- el caso espera respuesta.
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
-- 3. Cuantos deudores esperan respuesta, por gestor
--
-- Para el tablero del supervisor (126 -> UI). Solo admin: es un
-- dato de carga del equipo, no de la cartera propia.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_awaiting_replies(
  p_account_id UUID
)
RETURNS TABLE (
  agent_user_id UUID,
  agent_name TEXT,
  awaiting_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un supervisor puede ver las respuestas pendientes.'
      USING ERRCODE = '42501';
  END IF;

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
    SELECT d.assigned_to
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
      COUNT(*)::BIGINT AS awaiting_count
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
      COUNT(*)::BIGINT AS awaiting_count
    FROM pending p
    WHERE p.assigned_to IS NULL
  )
  SELECT
    rows.user_id,
    rows.name,
    rows.awaiting_count
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
--   DROP FUNCTION IF EXISTS public.collection_awaiting_replies(UUID);
--   DROP INDEX IF EXISTS public.idx_conversations_contact_whatsapp;
--   DROP FUNCTION IF EXISTS public.collection_agent_queue(
--     UUID, TEXT, TEXT, TEXT, INT, INT
--   );
--   -- Volver a crear collection_agent_queue desde la migracion 125
--   -- (su definicion anterior no tenia awaiting_reply).
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
