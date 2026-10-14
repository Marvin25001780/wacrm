-- ============================================================
-- 054_metrics_calls.sql — Datos para la sección LLAMADAS.
--
-- El CRM ya registra llamadas como ACTIVIDADES (tabla `activities`,
-- migration 033) con type = 'call' y, además, guarda duración,
-- estado, resultado y a quién se asignó. Para poder medir lo propio
-- de un centro de contacto faltaban dos datos:
--
--   1. `activities.call_direction` — Dirección de la llamada
--      (inbound / outbound). NULL para el resto de tipos de actividad.
--   2. `activities.call_result`    — Desenlace de la llamada
--      (answered / no_answer / busy / failed / voicemail). NULL para
--      el resto de tipos de actividad.
--
-- No se crea ninguna tabla nueva: las columnas son aditivas y solo
-- aplican cuando type = 'call'. Los GRANT/RLS de `activities` ya
-- existen (migration 033); añadir columnas no requiere permisos
-- nuevos, pero se reafirma el GRANT por si el entorno no lo tenía.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. Columnas nuevas en `activities`
-- ============================================================
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS call_direction TEXT;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS call_result TEXT;

-- CHECKs con nombre estable (DROP + ADD para que sea idempotente).
ALTER TABLE activities
  DROP CONSTRAINT IF EXISTS activities_call_direction_check;
ALTER TABLE activities
  ADD CONSTRAINT activities_call_direction_check
  CHECK (
    call_direction IS NULL
    OR call_direction IN ('inbound', 'outbound')
  );

ALTER TABLE activities
  DROP CONSTRAINT IF EXISTS activities_call_result_check;
ALTER TABLE activities
  ADD CONSTRAINT activities_call_result_check
  CHECK (
    call_result IS NULL
    OR call_result IN ('answered', 'no_answer', 'busy', 'failed', 'voicemail')
  );

-- Índice para el reporte: filtrar por tipo y fecha programada.
CREATE INDEX IF NOT EXISTS idx_activities_type_due
  ON activities(account_id, type, due_at);

-- ============================================================
-- 2. Permisos de tabla (RLS sigue gobernando FILA por FILA)
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON activities TO authenticated;
GRANT ALL ON activities TO service_role;
