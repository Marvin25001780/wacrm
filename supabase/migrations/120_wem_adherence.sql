-- ============================================================
-- 120_wem_adherence.sql — WEM: turnos, pausas y adherencia
--
-- Primer bloque de Workforce Engagement: mide si el agente cumple
-- el turno que tiene planificado y con qué motivos pausa.
--
-- Añade:
--   1. `agent_shifts` — turnos semanales recurrentes por agente
--      (día de la semana + hora local de Venezuela).
--   2. `agent_status_log` — bitácora de cambios de estado del
--      agente. Es la fuente para reconstruir intervalos: con los
--      cambios se sabe cuánto estuvo Disponible, Ocupado, en Cierre
--      o en Pausa, y con qué motivo.
--   3. `set_agent_status(p_status, p_reason, p_source)` — sigue
--      siendo la única puerta de escritura del estado; ahora deja el
--      evento en la bitácora (sin duplicar si el estado no cambió).
--
-- La zona horaria es America/Caracas (UTC-4, sin horario de verano).
-- Los turnos se guardan en hora local; la app los convierte a UTC al
-- calcular la adherencia.
--
-- Requiere 066, 106 y 112. Idempotente.
-- ============================================================

-- ============================================================
-- 1. Turnos semanales
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 0 = domingo … 6 = sábado (mismo criterio que Date.getDay()).
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  label TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_shifts_range CHECK (start_time <> end_time)
);

CREATE INDEX IF NOT EXISTS idx_agent_shifts_account_user
  ON public.agent_shifts(account_id, user_id, weekday, start_time);

-- Evita duplicar el mismo turno (contaría dos veces el programado).
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_shifts_unique
  ON public.agent_shifts(account_id, user_id, weekday, start_time, end_time);

ALTER TABLE public.agent_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_shifts_select ON public.agent_shifts;
DROP POLICY IF EXISTS agent_shifts_insert ON public.agent_shifts;
DROP POLICY IF EXISTS agent_shifts_update ON public.agent_shifts;
DROP POLICY IF EXISTS agent_shifts_delete ON public.agent_shifts;

CREATE POLICY agent_shifts_select ON public.agent_shifts
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY agent_shifts_insert ON public.agent_shifts
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY agent_shifts_update ON public.agent_shifts
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY agent_shifts_delete ON public.agent_shifts
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS agent_shifts_updated_at ON public.agent_shifts;
CREATE TRIGGER agent_shifts_updated_at
  BEFORE UPDATE ON public.agent_shifts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. Bitácora de estado del agente
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_status_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('available', 'busy', 'wrap_up', 'break')),
  previous_status TEXT
    CHECK (previous_status IS NULL
           OR previous_status IN ('available', 'busy', 'wrap_up', 'break')),
  -- Motivo de la pausa (solo aplica a 'break'). Lista fija en la app.
  reason TEXT,
  -- 'agent' = lo eligió la persona; 'system' = lo puso la app
  -- (reclamar una llamada, cierre automático).
  source TEXT NOT NULL DEFAULT 'agent'
    CHECK (source IN ('agent', 'system')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_status_log_reason_len
    CHECK (reason IS NULL OR char_length(reason) <= 60)
);

CREATE INDEX IF NOT EXISTS idx_agent_status_log_account_time
  ON public.agent_status_log(account_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_status_log_user_time
  ON public.agent_status_log(account_id, user_id, changed_at DESC);

ALTER TABLE public.agent_status_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_status_log_select ON public.agent_status_log;
DROP POLICY IF EXISTS agent_status_log_insert ON public.agent_status_log;
DROP POLICY IF EXISTS agent_status_log_delete ON public.agent_status_log;

-- Todo el negocio lee la bitácora (es la base de la adherencia);
-- escribir solo por la RPC; purgar solo admin+.
CREATE POLICY agent_status_log_select ON public.agent_status_log
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY agent_status_log_delete ON public.agent_status_log
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 3. set_agent_status con motivo y bitácora
--
-- Cambia la firma: se suelta la de un argumento para no dejar dos
-- versiones ambiguas. Las llamadas existentes (`p_status` solo)
-- siguen funcionando gracias a los valores por defecto.
-- ============================================================

DROP FUNCTION IF EXISTS public.set_agent_status(TEXT);

CREATE FUNCTION public.set_agent_status(
  p_status TEXT,
  p_reason TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'agent'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_previous TEXT;
  v_reason TEXT;
  v_source TEXT := COALESCE(NULLIF(btrim(p_source), ''), 'agent');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('available', 'busy', 'wrap_up', 'break') THEN
    RAISE EXCEPTION 'Invalid agent status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  IF v_source NOT IN ('agent', 'system') THEN
    RAISE EXCEPTION 'Invalid agent status source: %', v_source
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
    FROM profiles
   WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  -- Motivo: solo para pausas y con un tope defensivo.
  IF p_status = 'break' THEN
    v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
    IF v_reason IS NOT NULL AND char_length(v_reason) > 60 THEN
      RAISE EXCEPTION 'El motivo de la pausa no puede superar los 60 caracteres'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    v_reason := NULL;
  END IF;

  SELECT agent_status INTO v_previous
    FROM member_presence
   WHERE user_id = auth.uid();

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at, agent_status)
  VALUES (auth.uid(), v_account_id, 'online', now(), p_status)
  ON CONFLICT (user_id) DO UPDATE
    SET account_id   = excluded.account_id,
        status       = 'online',
        last_seen_at = now(),
        agent_status = excluded.agent_status;

  -- Solo se registra el cambio real: repetir el mismo estado es
  -- heartbeat, no un intervalo nuevo.
  IF v_previous IS DISTINCT FROM p_status THEN
    INSERT INTO agent_status_log (
      account_id, user_id, status, previous_status, reason, source
    ) VALUES (
      v_account_id, auth.uid(), p_status, v_previous, v_reason, v_source
    );
  END IF;
END;
$$;

ALTER FUNCTION public.set_agent_status(TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_agent_status(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_agent_status(TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 4. Permisos
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_shifts TO authenticated;
GRANT SELECT, DELETE ON TABLE public.agent_status_log TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   DROP FUNCTION IF EXISTS public.set_agent_status(TEXT, TEXT, TEXT);
--   -- Volver a crear la de la 112 (un argumento).
--   DROP TABLE IF EXISTS public.agent_status_log;
--   DROP TABLE IF EXISTS public.agent_shifts;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
