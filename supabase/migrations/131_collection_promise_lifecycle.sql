-- ============================================================
-- 131_collection_promise_lifecycle.sql — cierre real de las PTP
--
-- La 074 creó las promesas y la 076 dejó dos funciones para cerrarlas,
-- pero ninguna pantalla las usaba: una PTP vencida se quedaba
-- "pendiente" para siempre y las métricas de promesas rotas nunca
-- subían. Además `collection_mark_broken_promises` comparaba con
-- `CURRENT_DATE` (UTC), así que una promesa que vencía a las 8 de la
-- noche en Caracas se marcaba rota al día siguiente, no esa noche.
--
-- Esta migración:
--
--   1. endurece collection_resolve_promise()   quién puede cerrar y cómo
--   2. agrega collection_expire_promises()     vencidas con zona del negocio
--   3. reescribe collection_mark_broken_promises() para que delegue
--   4. agrega el índice de PTP abiertas por vencer
--
-- Reglas:
--   * cerrar (kept / broken / cancelled) solo desde pending o partial;
--   * puede cerrar un admin/owner del negocio, el gestor asignado al
--     deudor o quien creó la PTP;
--   * solo un admin puede reabrir (status = 'pending'), por si se
--     tipificó mal; al reabrir se limpia `resolved_at`;
--   * una PTP cerrada no se puede volver a cerrar con otro estado:
--     el historial no se reescribe;
--   * "vencida" usa la fecha local de `collection_settings.timezone`
--     (America/Caracas por defecto), no UTC;
--   * solo se marcan rotas las que tienen pago incompleto
--     (`paid_amount < amount`); las pagadas ya las cerró el trigger
--     de collection_payments (074).
--
-- Requiere 066, 073, 074, 076 y 126. Idempotente.
-- ============================================================

-- ============================================================
-- 0. Índice para la rutina de vencidas
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_collection_promises_open_due
  ON public.collection_promises (account_id, due_date)
  WHERE status IN ('pending', 'partial');

-- ============================================================
-- 1. Cierre (y reapertura) de una PTP
--
-- Mantiene la firma de la 076 (`promise_id, status`) porque la API ya
-- la llama así. Devuelve el estado anterior para que la UI pueda
-- deshacer con un clic si fue un error.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_resolve_promise(
  p_promise_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_current TEXT;
  v_debtor UUID;
  v_is_admin BOOLEAN;
  v_profile UUID;
  v_allowed BOOLEAN;
  v_resolved_at TIMESTAMPTZ;
BEGIN
  IF p_status NOT IN ('pending', 'kept', 'broken', 'cancelled') THEN
    RAISE EXCEPTION 'Estado de PTP inválido: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, p.status, p.debtor_id
    INTO v_account, v_current, v_debtor
    FROM public.collection_promises p
   WHERE p.id = p_promise_id
   FOR UPDATE;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'La PTP no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  v_is_admin := is_account_member(v_account, 'admin');

  IF p_status = 'pending' THEN
    -- Reapertura: solo supervisión y solo si estaba cerrada.
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Solo un supervisor puede reabrir una PTP.'
        USING ERRCODE = '42501';
    END IF;
    IF v_current = 'pending' THEN
      RAISE EXCEPTION 'La PTP ya está abierta.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Cierre: solo desde abierta, y solo el dueño del caso o un admin.
    IF v_current NOT IN ('pending', 'partial') THEN
      RAISE EXCEPTION 'La PTP ya está cerrada (%).', v_current
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_is_admin THEN
      SELECT d.assigned_to
        INTO v_profile
        FROM public.collection_debtors d
       WHERE d.id = v_debtor;

      v_allowed :=
        EXISTS (
          SELECT 1
            FROM public.collection_promises p
           WHERE p.id = p_promise_id
             AND p.created_by = auth.uid()
        )
        OR EXISTS (
          SELECT 1
            FROM public.profiles pr
           WHERE pr.id = v_profile
             AND pr.user_id = auth.uid()
        );

      IF NOT v_allowed THEN
        RAISE EXCEPTION 'Solo el gestor del deudor o su supervisor puede cerrar esta PTP.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  UPDATE public.collection_promises
     SET status = p_status,
         resolved_at = CASE WHEN p_status = 'pending' THEN NULL ELSE NOW() END,
         updated_at = NOW()
   WHERE id = p_promise_id
   RETURNING resolved_at INTO v_resolved_at;

  RETURN jsonb_build_object(
    'id', p_promise_id,
    'status', p_status,
    'previous_status', v_current,
    'resolved_at', v_resolved_at
  );
END;
$$;

COMMENT ON FUNCTION public.collection_resolve_promise(UUID, TEXT) IS
  'Cierra (kept/broken/cancelled) o reabre (pending) una PTP validando dueño del caso o admin.';

-- ============================================================
-- 2. Vencidas del negocio, con su zona horaria
--
-- `service_role` puede llamarla desde un cron; un usuario necesita
-- ser admin/owner del negocio. Devuelve cuántas cerró para que la UI
-- pueda decir la verdad ("se marcaron 3").
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_expire_promises(
  p_account_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_today DATE;
  v_closed INTEGER := 0;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un supervisor puede cerrar las PTP vencidas.'
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

  WITH expired AS (
    UPDATE public.collection_promises
       SET status = 'broken',
           resolved_at = NOW(),
           updated_at = NOW()
     WHERE account_id = p_account_id
       AND status IN ('pending', 'partial')
       AND paid_amount < amount
       AND due_date < v_today
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_closed FROM expired;

  RETURN jsonb_build_object(
    'closed', v_closed,
    'today', v_today,
    'timezone', v_tz
  );
END;
$$;

COMMENT ON FUNCTION public.collection_expire_promises(UUID) IS
  'Marca rotas las PTP vencidas con pago incompleto usando la fecha local del negocio.';

-- ============================================================
-- 3. Compatibilidad: la función de la 076 ahora delega
--
-- Si producción ya tiene un cron llamando al nombre viejo, sigue
-- funcionando, pero con la zona del negocio y con el mismo criterio
-- de permisos.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_mark_broken_promises(
  p_account_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.collection_expire_promises(p_account_id);
  RETURN COALESCE((v_result ->> 'closed')::INTEGER, 0);
END;
$$;

COMMENT ON FUNCTION public.collection_mark_broken_promises(UUID) IS
  'Compatibilidad 076: delega en collection_expire_promises (zona del negocio).';

-- ============================================================
-- 4. Permisos
-- ============================================================
REVOKE ALL ON FUNCTION public.collection_resolve_promise(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_expire_promises(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_mark_broken_promises(UUID) FROM PUBLIC;

ALTER FUNCTION public.collection_resolve_promise(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.collection_expire_promises(UUID) OWNER TO postgres;
ALTER FUNCTION public.collection_mark_broken_promises(UUID) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.collection_resolve_promise(UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_expire_promises(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_mark_broken_promises(UUID)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   -- Restaura la versión de la 076 (sin validación de dueño):
--   -- volver a ejecutar el bloque 4 de 076_collection_reporting.sql.
--   DROP FUNCTION IF EXISTS public.collection_expire_promises(UUID);
--   DROP INDEX IF EXISTS public.idx_collection_promises_open_due;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
