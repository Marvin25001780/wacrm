-- ============================================================
-- 121_wem_scheduled_breaks.sql — pausas programadas del turno
--
-- Hasta ahora la adherencia medía el turno completo, pero no si la
-- pausa se tomó cuando estaba planificada. Este bloque añade una
-- ventana de pausa opcional a cada turno semanal:
--
--   * `break_start` / `break_end` — ventana de pausa en hora local
--     de Venezuela. Ambas nulas (sin pausa programada) o ambas con
--     valor.
--   * `break_label` — etiqueta libre ("Almuerzo", "Merienda").
--
-- No crea tablas nuevas: la pausa pertenece al turno. Un turno que
-- cruza medianoche puede tener la pausa en cualquiera de sus dos
-- lados; el cálculo recorta la ventana a la consulta.
--
-- Requiere 120. Idempotente.
-- ============================================================

ALTER TABLE public.agent_shifts
  ADD COLUMN IF NOT EXISTS break_start TIME,
  ADD COLUMN IF NOT EXISTS break_end TIME,
  ADD COLUMN IF NOT EXISTS break_label TEXT;

-- Se recrean para que el script pueda correrse dos veces sin error.
ALTER TABLE public.agent_shifts
  DROP CONSTRAINT IF EXISTS agent_shifts_break_pair;
ALTER TABLE public.agent_shifts
  ADD CONSTRAINT agent_shifts_break_pair
  CHECK ((break_start IS NULL) = (break_end IS NULL));

ALTER TABLE public.agent_shifts
  DROP CONSTRAINT IF EXISTS agent_shifts_break_range;
ALTER TABLE public.agent_shifts
  ADD CONSTRAINT agent_shifts_break_range
  CHECK (break_start IS NULL OR break_start <> break_end);

ALTER TABLE public.agent_shifts
  DROP CONSTRAINT IF EXISTS agent_shifts_break_label_len;
ALTER TABLE public.agent_shifts
  ADD CONSTRAINT agent_shifts_break_label_len
  CHECK (break_label IS NULL OR char_length(break_label) <= 60);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   ALTER TABLE public.agent_shifts
--     DROP CONSTRAINT IF EXISTS agent_shifts_break_pair,
--     DROP CONSTRAINT IF EXISTS agent_shifts_break_range,
--     DROP CONSTRAINT IF EXISTS agent_shifts_break_label_len,
--     DROP COLUMN IF EXISTS break_start,
--     DROP COLUMN IF EXISTS break_end,
--     DROP COLUMN IF EXISTS break_label;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
