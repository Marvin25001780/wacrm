-- ============================================================
-- 118_queue_priority.sql — cola con prioridad y orden FIFO
--
-- Complemento del ACD (116): la cola pasa de "orden por llegada" a
-- "prioridad con desempate FIFO". Las entrantes con prioridad mayor
-- se atienden antes que las normales, y dentro de la misma prioridad
-- el orden de llegada manda (FIFO).
--
--   priority — entero 0..5; mayor = más urgente. Default 0 (normal).
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

ALTER TABLE call_sessions
  DROP CONSTRAINT IF EXISTS call_sessions_priority_check;
ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_priority_check
  CHECK (priority >= 0 AND priority <= 5);

CREATE INDEX IF NOT EXISTS idx_call_sessions_account_queue
  ON call_sessions(account_id, status, priority DESC, started_at ASC);

NOTIFY pgrst, 'reload schema';
