-- ============================================================
-- 112_telephony.sql — Núcleo de telefonía (contact center)
--
-- Convierte las "llamadas" del CRM (registros manuales en
-- `activities`) en sesiones reales de voz. La media y la
-- señalización las pone LiveKit (Apache-2.0): el navegador habla
-- WebRTC con LiveKit y LiveKit habla SIP con la troncal del
-- operador. Este CRM solo guarda estado, eventos y el resultado.
--
-- Añade:
--   1. `telephony_config` — ajustes por negocio (línea saliente,
--      troncal SIP, grabación y transcripción). Los secretos
--      (API key/secret de LiveKit) NO viven aquí: van en variables
--      de entorno del servidor.
--   2. `call_sessions` — una fila por llamada, con tiempos,
--      participantes, grabación y transcripción.
--   3. `call_events` — bitácora append-only de la llamada (creada,
--      sonando, contestada, grabación lista, finalizada...).
--   4. `member_presence.agent_status` — estado de agente para el
--      contact center (disponible / ocupado / cierre / pausa).
--   5. RPC `set_agent_status` — el agente solo puede cambiar su
--      propio estado.
--
-- Multi-tenant: todas las tablas llevan `account_id` y RLS por
-- `is_account_member`. La troncal y la cuenta de LiveKit son del
-- despliegue (una instancia puede atender varios negocios; cada
-- llamada se etiqueta con su `account_id`).
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- 1. Configuración de telefonía por negocio
-- ============================================================
CREATE TABLE IF NOT EXISTS telephony_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  -- Interruptor por negocio: si está apagado, el softphone no marca.
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Hoy solo LiveKit. Se deja como texto para admitir otros
  -- proveedores SIP/WebRTC sin migrar la tabla.
  provider TEXT NOT NULL DEFAULT 'livekit'
    CHECK (provider IN ('livekit')),
  -- Número que ve el cliente (E.164). NULL = el de la troncal.
  outbound_caller_id TEXT,
  -- ID de la troncal saliente en LiveKit. NULL = la del entorno
  -- (LIVEKIT_SIP_TRUNK_ID).
  sip_outbound_trunk_id TEXT,
  -- Números entrantes de este negocio. El webhook de LiveKit mira
  -- el número marcado por el cliente para saber a qué cuenta
  -- pertenece la llamada.
  inbound_numbers TEXT[] NOT NULL DEFAULT '{}'::text[],
  recording_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  transcription_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE telephony_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telephony_config_select ON telephony_config;
DROP POLICY IF EXISTS telephony_config_insert ON telephony_config;
DROP POLICY IF EXISTS telephony_config_update ON telephony_config;
DROP POLICY IF EXISTS telephony_config_delete ON telephony_config;

-- Cualquier miembro puede leer la configuración (la UI muestra si
-- la telefonía está activa); solo admin+ la cambia.
CREATE POLICY telephony_config_select ON telephony_config
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY telephony_config_insert ON telephony_config
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY telephony_config_update ON telephony_config
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY telephony_config_delete ON telephony_config
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS telephony_config_updated_at ON telephony_config;
CREATE TRIGGER telephony_config_updated_at
  BEFORE UPDATE ON telephony_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. Sesiones de llamada
-- ============================================================
CREATE TABLE IF NOT EXISTS call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  provider TEXT NOT NULL DEFAULT 'livekit'
    CHECK (provider IN ('livekit', 'manual')),
  -- Sala de LiveKit. Única: es la llave para casar webhooks.
  room_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ringing'
    CHECK (status IN ('ringing', 'active', 'ended', 'missed', 'failed', 'cancelled')),
  from_number TEXT,
  to_number TEXT,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  -- Agente que atiende (profiles.id) y su usuario (auth.users.id).
  agent_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  agent_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  end_reason TEXT,
  -- Grabación (Egress de LiveKit) y transcripción.
  recording_url TEXT,
  recording_egress_id TEXT,
  transcript TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'none'
    CHECK (transcript_status IN ('none', 'pending', 'processing', 'done', 'failed')),
  ai_summary TEXT,
  -- Actividad de CRM creada al colgar (alimenta /metrics/llamadas).
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_account_started
  ON call_sessions(account_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_account_agent
  ON call_sessions(account_id, agent_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_contact
  ON call_sessions(contact_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_status
  ON call_sessions(account_id, status);

ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_sessions_select ON call_sessions;
DROP POLICY IF EXISTS call_sessions_insert ON call_sessions;
DROP POLICY IF EXISTS call_sessions_update ON call_sessions;
DROP POLICY IF EXISTS call_sessions_delete ON call_sessions;

-- Viewer+ lee (métricas y ficha del contacto); agente+ crea y
-- actualiza sus propias llamadas; admin+ puede tocar cualquiera.
CREATE POLICY call_sessions_select ON call_sessions
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY call_sessions_insert ON call_sessions
  FOR INSERT WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (agent_user_id = auth.uid() OR agent_user_id IS NULL)
  );
CREATE POLICY call_sessions_update ON call_sessions
  FOR UPDATE USING (
    is_account_member(account_id, 'agent')
    AND (
      agent_user_id = auth.uid()
      OR agent_user_id IS NULL
      OR is_account_member(account_id, 'admin')
    )
  )
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (
      agent_user_id = auth.uid()
      OR agent_user_id IS NULL
      OR is_account_member(account_id, 'admin')
    )
  );
CREATE POLICY call_sessions_delete ON call_sessions
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS call_sessions_updated_at ON call_sessions;
CREATE TRIGGER call_sessions_updated_at
  BEFORE UPDATE ON call_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. Eventos de la llamada (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS call_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_events_call
  ON call_events(call_id, created_at);
CREATE INDEX IF NOT EXISTS idx_call_events_account
  ON call_events(account_id, created_at DESC);

ALTER TABLE call_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_events_select ON call_events;
DROP POLICY IF EXISTS call_events_insert ON call_events;
DROP POLICY IF EXISTS call_events_delete ON call_events;

CREATE POLICY call_events_select ON call_events
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY call_events_insert ON call_events
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
-- Sin UPDATE: la bitácora no se reescribe. El admin puede purgarla
-- al borrar la llamada (DELETE en cascada no requiere política).
CREATE POLICY call_events_delete ON call_events
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 4. Estado de agente en `member_presence`
-- ============================================================
-- `member_presence.status` sigue siendo online/away (heartbeat).
-- `agent_status` es la disponibilidad operativa del contact center.
ALTER TABLE member_presence
  ADD COLUMN IF NOT EXISTS agent_status TEXT NOT NULL DEFAULT 'available';

ALTER TABLE member_presence
  DROP CONSTRAINT IF EXISTS member_presence_agent_status_check;
ALTER TABLE member_presence
  ADD CONSTRAINT member_presence_agent_status_check
  CHECK (agent_status IN ('available', 'busy', 'wrap_up', 'break'));

-- El agente cambia SU estado. La cuenta y el usuario se derivan de
-- la sesión, nunca del cuerpo de la petición.
CREATE OR REPLACE FUNCTION public.set_agent_status(
  p_status TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('available', 'busy', 'wrap_up', 'break') THEN
    RAISE EXCEPTION 'Invalid agent status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at, agent_status)
  VALUES (auth.uid(), v_account_id, 'online', now(), p_status)
  ON CONFLICT (user_id) DO UPDATE
    SET account_id   = excluded.account_id,
        status       = 'online',
        last_seen_at = now(),
        agent_status = excluded.agent_status;
END;
$$;

-- ============================================================
-- 5. Permisos y realtime
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.telephony_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.call_sessions TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.call_events TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'call_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE call_sessions;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
