-- ============================================================
-- 124_campaign_progressive.sql — campañas con "siguiente contacto"
--
-- La 117 dejó la v1: el admin armaba una lista y marcaba contacto por
-- contacto. Aquí la campaña pasa a ser una cola de trabajo:
--
--   pending --claim--> dialing --(llamada)--> called
--                        |                     exhausted (sin intentos)
--                        +--release--> pending
--
-- Reglas:
--   * Un agente pide el siguiente contacto y la base se lo reserva de
--     forma atómica (FOR UPDATE SKIP LOCKED): dos agentes nunca
--     reciben el mismo contacto.
--   * Mientras la llamada existe, el contacto queda en `dialing` y
--     ningún otro agente lo puede tomar.
--   * Al terminar la llamada, `record_campaign_attempt` cuenta el
--     intento. Si contestaron, el contacto queda `called`. Si no,
--     vuelve a `pending` mientras le queden intentos
--     (`outbound_campaigns.max_attempts`); si no, `exhausted`.
--   * La reserva vence a los 2 minutos. Si el navegador se cayó antes
--     de marcar, el contacto vuelve solo a la cola cuando otro agente
--     pide el siguiente (barrido perezoso, sin cron).
--   * Cuando ya no quedan pendientes, la campaña se cierra como
--     `completed`.
--
-- No hay marcación automática: el agente pulsa "Siguiente contacto" y
-- el CRM reclama + marca en un solo paso. Sin troncal SIP la llamada
-- real sigue sin poder probarse, pero la cola y sus reglas sí.
--
-- Requiere 117 (campañas) y 112 (call_sessions). Idempotente.
-- ============================================================

-- ============================================================
-- 1. Campaña: estado y tope de intentos
-- ============================================================

ALTER TABLE public.outbound_campaigns
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.outbound_campaigns
  DROP CONSTRAINT IF EXISTS outbound_campaigns_status_check;
ALTER TABLE public.outbound_campaigns
  ADD CONSTRAINT outbound_campaigns_status_check
  CHECK (status IN ('active', 'paused', 'completed'));

ALTER TABLE public.outbound_campaigns
  DROP CONSTRAINT IF EXISTS outbound_campaigns_max_attempts_check;
ALTER TABLE public.outbound_campaigns
  ADD CONSTRAINT outbound_campaigns_max_attempts_check
  CHECK (max_attempts BETWEEN 1 AND 10);

-- ============================================================
-- 2. Contacto de campaña: intentos, reserva y resultado
-- ============================================================

ALTER TABLE public.outbound_campaign_contacts
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outcome TEXT,
  ADD COLUMN IF NOT EXISTS last_call_id UUID
    REFERENCES public.call_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;

ALTER TABLE public.outbound_campaign_contacts
  DROP CONSTRAINT IF EXISTS outbound_campaign_contacts_status_check;
ALTER TABLE public.outbound_campaign_contacts
  ADD CONSTRAINT outbound_campaign_contacts_status_check
  CHECK (status IN ('pending', 'dialing', 'called', 'exhausted'));

ALTER TABLE public.outbound_campaign_contacts
  DROP CONSTRAINT IF EXISTS outbound_campaign_contacts_attempts_check;
ALTER TABLE public.outbound_campaign_contacts
  ADD CONSTRAINT outbound_campaign_contacts_attempts_check
  CHECK (attempts >= 0);

ALTER TABLE public.outbound_campaign_contacts
  DROP CONSTRAINT IF EXISTS outbound_campaign_contacts_outcome_check;
ALTER TABLE public.outbound_campaign_contacts
  ADD CONSTRAINT outbound_campaign_contacts_outcome_check
  CHECK (
    last_outcome IS NULL
    OR last_outcome IN ('answered', 'missed', 'failed', 'cancelled', 'unknown')
  );

CREATE INDEX IF NOT EXISTS idx_outbound_campaign_contacts_next
  ON public.outbound_campaign_contacts(campaign_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbound_campaign_contacts_reserved
  ON public.outbound_campaign_contacts(campaign_id, reserved_until)
  WHERE reserved_until IS NOT NULL;

-- ============================================================
-- 3. Reclamar el siguiente contacto (atómico)
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_campaign_contact(
  p_campaign_id UUID,
  p_reservation_seconds INT DEFAULT 120
) RETURNS SETOF public.outbound_campaign_contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_status TEXT;
  v_seconds INT;
BEGIN
  -- La reserva vive entre 30 s y 10 min; por defecto 2 min.
  v_seconds := GREATEST(30, LEAST(COALESCE(p_reservation_seconds, 120), 600));

  SELECT account_id, status
    INTO v_account, v_status
    FROM public.outbound_campaigns
   WHERE id = p_campaign_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'La campaña no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'La campaña no está activa.' USING ERRCODE = 'P0001';
  END IF;

  -- Reservas vencidas que nunca llegaron a marcar.
  UPDATE public.outbound_campaign_contacts
     SET status = 'pending',
         assigned_user_id = NULL,
         reserved_until = NULL
   WHERE campaign_id = p_campaign_id
     AND status = 'dialing'
     AND call_session_id IS NULL
     AND (reserved_until IS NULL OR reserved_until < NOW());

  -- Marcaciones que terminaron sin que el contacto se cerrara (se
  -- cayó el navegador o el webhook no llegó). Cuenta el intento para
  -- no reintentar para siempre.
  UPDATE public.outbound_campaign_contacts c
     SET attempts = c.attempts + 1,
         last_outcome = COALESCE(c.last_outcome, 'unknown'),
         last_attempt_at = COALESCE(c.last_attempt_at, NOW()),
         status = CASE
           WHEN c.attempts + 1 >= camp.max_attempts THEN 'exhausted'
           ELSE 'pending'
         END,
         assigned_user_id = NULL,
         reserved_until = NULL
    FROM public.outbound_campaigns camp
   WHERE camp.id = c.campaign_id
     AND c.campaign_id = p_campaign_id
     AND c.status = 'dialing'
     AND c.call_session_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.call_sessions s
        WHERE s.id = c.call_session_id
          AND s.status IN ('ended', 'missed', 'failed', 'cancelled')
     );

  -- Pendientes que ya no pueden intentarse (el admin bajó el tope de
  -- intentos o venían agotados): pasan a `exhausted` antes de contar
  -- si queda trabajo.
  UPDATE public.outbound_campaign_contacts c
     SET status = 'exhausted'
    FROM public.outbound_campaigns camp
   WHERE camp.id = c.campaign_id
     AND c.campaign_id = p_campaign_id
     AND c.status = 'pending'
     AND c.attempts >= camp.max_attempts;

  -- Si ya no queda trabajo, se cierra sola.
  IF NOT EXISTS (
    SELECT 1
      FROM public.outbound_campaign_contacts
     WHERE campaign_id = p_campaign_id
       AND status IN ('pending', 'dialing')
  ) THEN
    UPDATE public.outbound_campaigns
       SET status = 'completed',
           completed_at = COALESCE(completed_at, NOW())
     WHERE id = p_campaign_id
       AND status = 'active';
    RETURN;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT c.id
      FROM public.outbound_campaign_contacts c
      JOIN public.outbound_campaigns camp ON camp.id = c.campaign_id
     WHERE c.campaign_id = p_campaign_id
       AND c.status = 'pending'
       AND c.attempts < camp.max_attempts
     ORDER BY c.created_at ASC, c.id ASC
     FOR UPDATE OF c SKIP LOCKED
     LIMIT 1
  ), updated AS (
    UPDATE public.outbound_campaign_contacts c
       SET status = 'dialing',
           assigned_user_id = auth.uid(),
           reserved_until = NOW() + make_interval(secs => v_seconds)
      FROM picked
     WHERE c.id = picked.id
    RETURNING c.*
  )
  SELECT * FROM updated;
END;
$$;

-- ============================================================
-- 4. Vincular la llamada recién creada al contacto reclamado
-- ============================================================

CREATE OR REPLACE FUNCTION public.attach_campaign_call(
  p_contact_id UUID,
  p_call_id UUID
) RETURNS SETOF public.outbound_campaign_contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT camp.account_id
    INTO v_account
    FROM public.outbound_campaign_contacts c
    JOIN public.outbound_campaigns camp ON camp.id = c.campaign_id
   WHERE c.id = p_contact_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'El contacto de campaña no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH updated AS (
    UPDATE public.outbound_campaign_contacts c
       SET call_session_id = p_call_id,
           last_call_id = p_call_id,
           last_attempt_at = NOW(),
           reserved_until = NULL
     WHERE c.id = p_contact_id
       AND c.status = 'dialing'
       AND (
         c.assigned_user_id = auth.uid()
         OR is_account_member(v_account, 'admin')
       )
       AND EXISTS (
         SELECT 1
           FROM public.call_sessions s
          WHERE s.id = p_call_id
            AND s.account_id = v_account
            AND s.direction = 'outbound'
            AND s.metadata->>'campaign_contact_id' = p_contact_id::text
       )
    RETURNING c.*
  )
  SELECT * FROM updated;
END;
$$;

-- ============================================================
-- 5. Cerrar el intento cuando termina la llamada
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_campaign_attempt(
  p_contact_id UUID,
  p_call_id UUID,
  p_outcome TEXT
) RETURNS SETOF public.outbound_campaign_contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_campaign UUID;
  v_max INT;
  v_outcome TEXT;
BEGIN
  v_outcome := lower(COALESCE(p_outcome, 'unknown'));
  IF v_outcome NOT IN ('answered', 'missed', 'failed', 'cancelled', 'unknown') THEN
    v_outcome := 'unknown';
  END IF;

  SELECT camp.account_id, camp.id, camp.max_attempts
    INTO v_account, v_campaign, v_max
    FROM public.outbound_campaign_contacts c
    JOIN public.outbound_campaigns camp ON camp.id = c.campaign_id
   WHERE c.id = p_contact_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'El contacto de campaña no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  -- Solo cierra contactos que están marcando: repetir la llamada al
  -- webhook no infla los intentos.
  RETURN QUERY
  WITH updated AS (
    UPDATE public.outbound_campaign_contacts c
       SET attempts = c.attempts + 1,
           last_attempt_at = NOW(),
           last_outcome = v_outcome,
           last_call_id = p_call_id,
           call_session_id = p_call_id,
           status = CASE
             WHEN v_outcome = 'answered' THEN 'called'
             WHEN c.attempts + 1 >= v_max THEN 'exhausted'
             ELSE 'pending'
           END,
           called_at = CASE
             WHEN v_outcome = 'answered' THEN NOW()
             ELSE c.called_at
           END,
           assigned_user_id = NULL,
           reserved_until = NULL
     WHERE c.id = p_contact_id
       AND c.status = 'dialing'
    RETURNING c.*
  )
  SELECT * FROM updated;

  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.outbound_campaign_contacts
       WHERE campaign_id = v_campaign
         AND status IN ('pending', 'dialing')
    ) THEN
      UPDATE public.outbound_campaigns
         SET status = 'completed',
             completed_at = COALESCE(completed_at, NOW())
       WHERE id = v_campaign
         AND status = 'active';
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- 6. Soltar una reserva que no llegó a marcar
-- ============================================================

CREATE OR REPLACE FUNCTION public.release_campaign_contact(
  p_contact_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.outbound_campaign_contacts
     SET status = 'pending',
         assigned_user_id = NULL,
         reserved_until = NULL,
         call_session_id = NULL
   WHERE id = p_contact_id
     AND status = 'dialing'
     AND call_session_id IS NULL
     AND assigned_user_id = auth.uid();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- ============================================================
-- 7. Permisos
-- ============================================================

REVOKE ALL ON FUNCTION public.claim_campaign_contact(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_campaign_call(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_campaign_attempt(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_campaign_contact(UUID) FROM PUBLIC;

ALTER FUNCTION public.claim_campaign_contact(UUID, INT) OWNER TO postgres;
ALTER FUNCTION public.attach_campaign_call(UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.record_campaign_attempt(UUID, UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.release_campaign_contact(UUID) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.claim_campaign_contact(UUID, INT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attach_campaign_call(UUID, UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_campaign_attempt(UUID, UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_campaign_contact(UUID)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   DROP FUNCTION IF EXISTS public.release_campaign_contact(UUID);
--   DROP FUNCTION IF EXISTS public.record_campaign_attempt(UUID, UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.attach_campaign_call(UUID, UUID);
--   DROP FUNCTION IF EXISTS public.claim_campaign_contact(UUID, INT);
--   DROP INDEX IF EXISTS public.idx_outbound_campaign_contacts_reserved;
--   DROP INDEX IF EXISTS public.idx_outbound_campaign_contacts_next;
--   ALTER TABLE public.outbound_campaign_contacts
--     DROP COLUMN IF EXISTS reserved_until,
--     DROP COLUMN IF EXISTS assigned_user_id,
--     DROP COLUMN IF EXISTS last_call_id,
--     DROP COLUMN IF EXISTS last_outcome,
--     DROP COLUMN IF EXISTS last_attempt_at,
--     DROP COLUMN IF EXISTS attempts;
--   ALTER TABLE public.outbound_campaigns
--     DROP COLUMN IF EXISTS completed_at,
--     DROP COLUMN IF EXISTS max_attempts,
--     DROP COLUMN IF EXISTS status;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
