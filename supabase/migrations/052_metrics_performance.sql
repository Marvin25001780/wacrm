-- ============================================================
-- 052_metrics_performance.sql — Datos para la sección RENDIMIENTO.
--
-- Piezas nuevas:
--   1. `csat_responses`      — encuestas de satisfacción (1..5) por
--      conversación, con el agente evaluado.
--   2. `agent_status_events` — histórico de cambios de estado de los
--      agentes (online / away / busy / break). Alimenta el panel
--      "Registros de estado de los agentes".
--   3. `touch_presence`      — se reemplaza para escribir un evento
--      SOLO cuando el estado cambia (no en cada latido de 30s).
--
-- Los tiempos de primera respuesta / respuesta / cierre NO necesitan
-- tablas nuevas: se calculan de `messages` y `conversations.closed_at`.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. csat_responses
-- ============================================================
CREATE TABLE IF NOT EXISTS csat_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- auth.users.id del agente evaluado (mismo espacio que sender_id /
  -- assigned_agent_id).
  agent_id UUID,
  score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'survey')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csat_account ON csat_responses(account_id);
CREATE INDEX IF NOT EXISTS idx_csat_conversation ON csat_responses(conversation_id);
CREATE INDEX IF NOT EXISTS idx_csat_agent ON csat_responses(agent_id);
CREATE INDEX IF NOT EXISTS idx_csat_created ON csat_responses(account_id, created_at);

ALTER TABLE csat_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS csat_responses_select ON csat_responses;
DROP POLICY IF EXISTS csat_responses_insert ON csat_responses;
DROP POLICY IF EXISTS csat_responses_update ON csat_responses;
DROP POLICY IF EXISTS csat_responses_delete ON csat_responses;

CREATE POLICY csat_responses_select ON csat_responses
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY csat_responses_insert ON csat_responses
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY csat_responses_update ON csat_responses
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY csat_responses_delete ON csat_responses
  FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- 2. agent_status_events
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_status_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('online', 'away', 'busy', 'break', 'offline')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_events_account
  ON agent_status_events(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_status_events_user
  ON agent_status_events(user_id, created_at);

ALTER TABLE agent_status_events ENABLE ROW LEVEL SECURITY;

-- Solo lectura para miembros; las escrituras llegan por touch_presence().
DROP POLICY IF EXISTS agent_status_events_select ON agent_status_events;
CREATE POLICY agent_status_events_select ON agent_status_events FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- 2b. touch_presence — registra el cambio de estado
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_presence(
  p_status TEXT DEFAULT 'online'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_prev_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_prev_status
  FROM member_presence
  WHERE user_id = auth.uid();

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id) DO UPDATE
    SET status       = excluded.status,
        last_seen_at = now(),
        account_id   = excluded.account_id;

  -- Histórico para métricas: solo cuando el estado CAMBIA.
  IF v_prev_status IS DISTINCT FROM p_status THEN
    INSERT INTO agent_status_events (account_id, user_id, status, created_at)
    VALUES (v_account_id, auth.uid(), p_status, now());
  END IF;
END;
$$;

-- ============================================================
-- 3. Permisos de tabla (RLS sigue gobernando las filas)
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON csat_responses TO authenticated;
GRANT SELECT ON agent_status_events TO authenticated;

GRANT ALL ON csat_responses, agent_status_events TO service_role;
