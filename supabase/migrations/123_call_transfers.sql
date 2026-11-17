-- ============================================================
-- 123_call_transfers.sql — transferencias internas de llamadas
--
-- Un agente que está hablando puede pasar la llamada a otro agente
-- del mismo negocio o devolverla a la cola. La llamada sigue viva en
-- la sala de LiveKit: el cliente nunca se queda sin audio, solo
-- cambia quién la atiende.
--
-- Mientras el nuevo agente no contesta, la sesión vuelve a `ringing`
-- con `agent_user_id` apuntando a él y `transfer_at` como marca de
-- tiempo. Si no contesta en `transfer_timeout_seconds`, la función
-- `release_expired_transfers` la devuelve a la cola (sin cerrarla).
--
-- `transfer_from_user_id` guarda quién la pasó (para la UI y la
-- bitácora) y `transfer_count` evita bucles entre agentes.
--
-- Requiere 112 (call_sessions, telephony_config). Idempotente.
-- ============================================================

-- ---- call_sessions: estado de la transferencia ----------------

ALTER TABLE public.call_sessions
  ADD COLUMN IF NOT EXISTS transfer_from_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transfer_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transfer_timeout_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS transfer_count INTEGER NOT NULL DEFAULT 0,
  -- Momento en que la llamada entró a la cola por última vez. Se
  -- reinicia cuando una transferencia vuelve a la cola o vence el
  -- timbre; el timeout de espera se mide desde aquí.
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;

ALTER TABLE public.call_sessions
  DROP CONSTRAINT IF EXISTS call_sessions_transfer_timeout_check;
ALTER TABLE public.call_sessions
  ADD CONSTRAINT call_sessions_transfer_timeout_check
  CHECK (
    transfer_timeout_seconds IS NULL
    OR transfer_timeout_seconds BETWEEN 5 AND 300
  );

ALTER TABLE public.call_sessions
  DROP CONSTRAINT IF EXISTS call_sessions_transfer_count_check;
ALTER TABLE public.call_sessions
  ADD CONSTRAINT call_sessions_transfer_count_check
  CHECK (transfer_count >= 0);

-- Búsqueda del barrido: llamadas sonando por una transferencia.
CREATE INDEX IF NOT EXISTS idx_call_sessions_transfer_ringing
  ON public.call_sessions(account_id, transfer_at)
  WHERE transfer_at IS NOT NULL;

-- ---- telephony_config: ajustes del negocio --------------------

ALTER TABLE public.telephony_config
  ADD COLUMN IF NOT EXISTS transfer_ring_timeout_seconds INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS max_transfers_per_call INTEGER NOT NULL DEFAULT 3;

ALTER TABLE public.telephony_config
  DROP CONSTRAINT IF EXISTS telephony_config_transfer_ring_timeout_check;
ALTER TABLE public.telephony_config
  ADD CONSTRAINT telephony_config_transfer_ring_timeout_check
  CHECK (transfer_ring_timeout_seconds BETWEEN 5 AND 300);

ALTER TABLE public.telephony_config
  DROP CONSTRAINT IF EXISTS telephony_config_max_transfers_check;
ALTER TABLE public.telephony_config
  ADD CONSTRAINT telephony_config_max_transfers_check
  CHECK (max_transfers_per_call BETWEEN 0 AND 10);

-- ---- Barrido de transferencias vencidas ----------------------

-- Devuelve a la cola las llamadas cuya transferencia no fue
-- contestada. Va por RPC SECURITY DEFINER porque quien barre puede
-- no ser el agente asignado (por ejemplo, otro agente que abre el
-- softphone) y la RLS de `call_sessions` no le dejaría escribir.
--
-- No cierra la llamada: el cliente sigue en la sala esperando.
CREATE OR REPLACE FUNCTION public.release_expired_transfers(
  p_account_id UUID
) RETURNS SETOF public.call_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    UPDATE public.call_sessions c
       SET agent_user_id = NULL,
           agent_profile_id = NULL,
           transfer_at = NULL,
           transfer_timeout_seconds = NULL,
           queued_at = now(),
           updated_at = now()
     WHERE c.account_id = p_account_id
       AND c.status = 'ringing'
       AND c.transfer_at IS NOT NULL
       AND c.transfer_at
           + (COALESCE(c.transfer_timeout_seconds, 25) * INTERVAL '1 second')
           < now()
    RETURNING c.*;
END;
$$;

ALTER FUNCTION public.release_expired_transfers(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.release_expired_transfers(UUID)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   DROP FUNCTION IF EXISTS public.release_expired_transfers(UUID);
--   DROP INDEX IF EXISTS public.idx_call_sessions_transfer_ringing;
--   ALTER TABLE public.call_sessions
--     DROP CONSTRAINT IF EXISTS call_sessions_transfer_timeout_check,
--     DROP CONSTRAINT IF EXISTS call_sessions_transfer_count_check,
--     DROP COLUMN IF EXISTS transfer_from_user_id,
--     DROP COLUMN IF EXISTS transfer_at,
--     DROP COLUMN IF EXISTS transfer_timeout_seconds,
--     DROP COLUMN IF EXISTS transfer_count,
--     DROP COLUMN IF EXISTS queued_at;
--   ALTER TABLE public.telephony_config
--     DROP CONSTRAINT IF EXISTS telephony_config_transfer_ring_timeout_check,
--     DROP CONSTRAINT IF EXISTS telephony_config_max_transfers_check,
--     DROP COLUMN IF EXISTS transfer_ring_timeout_seconds,
--     DROP COLUMN IF EXISTS max_transfers_per_call;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
