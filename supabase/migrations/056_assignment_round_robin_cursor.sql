-- ============================================================
-- 056_assignment_round_robin_cursor.sql — Round-robin real.
--
-- `assignment_rules.strategy` acepta 'round_robin', pero el
-- resolver la resolvía igual que 'least_busy' (menos conversaciones
-- abiertas gana), así que ninguna regla llegaba a repartir por turnos
-- y el hint de la UI («Reparte por turnos entre el equipo o grupo»)
-- era mentira.
--
-- Para rotar hace falta memoria de quién le tocó: esta columna es el
-- cursor de la regla. En cada resolución se elige el candidato que va
-- después del cursor en orden ascendente de id (A → B → C → A …) y
-- el cursor avanza con el valor elegido.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- NULL = aún no se ha asignado nada con esta regla; el primer turno
-- empieza en el primer candidato (id ascendente). Si el agente se
-- borra, el cursor vuelve a NULL y el ciclo empieza de cero.
ALTER TABLE assignment_rules
  ADD COLUMN IF NOT EXISTS last_assigned_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN assignment_rules.last_assigned_user_id IS
  'Cursor de round_robin: último agente al que le tocó esta regla. '
  'NULL = empieza por el primer candidato (id ascendente).';
