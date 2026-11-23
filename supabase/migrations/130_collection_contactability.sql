-- ============================================================
-- 130_collection_contactability.sql - contactabilidad por hora
--
-- La supervisión dice cuanto se trabajo; los reportes dicen cuanto
-- se recupero. Falta la pregunta operativa del turno: ?a que hora
-- contesta la gente? En cobranza telefonica, mover la misma lista
-- dos horas puede duplicar los contactos, y hoy eso se decide por
-- intuicion.
--
-- Esta migracion agrega:
--
--   collection_contactability(account_id, days)
--
-- Una fila por (dia de la semana, hora local) con intentos,
-- contactos, deudores distintos y gestores distintos, usando la
-- zona horaria del negocio (America/Caracas por defecto). La UI
-- arma con eso un mapa de calor y propone las mejores franjas.
--
-- Reglas:
--   - solo gestiones de canal 'call' (las de WhatsApp ya se miden
--     en la supervision, con su SLA);
--   - "contacto" es level1_code en ('contacted','third_party'), el
--     mismo criterio del tablero (126) y del rendimiento (076);
--   - la ventana se limita a 7..90 dias para que la consulta no
--     recorra anos de historial;
--   - es agregado por hora: no expone la actividad de una persona
--     concreta, pero valida pertenencia al negocio;
--   - la tasa de contacto se calcula en el cliente (contacts /
--     attempts); aqui solo salen conteos reales.
--
-- Requiere 073, 074, 076 y 126. Idempotente.
-- ============================================================

-- ============================================================
-- 1. Indice para la ventana de llamadas
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_collection_actions_calls_recent
  ON public.collection_actions (account_id, created_at DESC)
  WHERE channel = 'call';

-- ============================================================
-- 2. Contactabilidad por dia y hora
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_contactability(
  p_account_id UUID,
  p_days INT DEFAULT 30
)
RETURNS TABLE (
  weekday SMALLINT,
  hour_of_day SMALLINT,
  attempts BIGINT,
  contacts BIGINT,
  debtors BIGINT,
  agents BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tz TEXT;
  v_days INT;
  v_since TIMESTAMPTZ;
BEGIN
  IF NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(NULLIF(btrim(s.timezone), ''), 'America/Caracas')
    INTO v_tz
    FROM public.collection_settings s
   WHERE s.account_id = p_account_id;

  v_tz := COALESCE(v_tz, 'America/Caracas');
  v_days := GREATEST(7, LEAST(COALESCE(p_days, 30), 90));
  v_since := NOW() - make_interval(days => v_days);

  RETURN QUERY
  SELECT
    EXTRACT(ISODOW FROM a.created_at AT TIME ZONE v_tz)::SMALLINT AS weekday,
    EXTRACT(HOUR FROM a.created_at AT TIME ZONE v_tz)::SMALLINT AS hour_of_day,
    COUNT(*)::BIGINT AS attempts,
    COUNT(*) FILTER (
      WHERE a.level1_code IN ('contacted', 'third_party')
    )::BIGINT AS contacts,
    COUNT(DISTINCT a.debtor_id)::BIGINT AS debtors,
    COUNT(DISTINCT a.user_id)::BIGINT AS agents
  FROM public.collection_actions a
  WHERE a.account_id = p_account_id
    AND a.channel = 'call'
    AND a.created_at >= v_since
  GROUP BY 1, 2
  ORDER BY 1 ASC, 2 ASC;
END;
$$;

COMMENT ON FUNCTION public.collection_contactability(UUID, INT) IS
  'Intentos y contactos de llamadas por dia de la semana y hora local (7..90 dias).';

-- ============================================================
-- 3. Permisos
-- ============================================================
REVOKE ALL ON FUNCTION public.collection_contactability(UUID, INT) FROM PUBLIC;

ALTER FUNCTION public.collection_contactability(UUID, INT) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.collection_contactability(UUID, INT)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   DROP FUNCTION IF EXISTS public.collection_contactability(UUID, INT);
--   DROP INDEX IF EXISTS public.idx_collection_actions_calls_recent;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
