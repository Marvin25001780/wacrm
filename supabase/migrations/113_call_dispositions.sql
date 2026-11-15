-- ============================================================
-- 113_call_dispositions.sql — cierre de llamada con disposición
--
-- Un contact center no termina cuando se cuelga: el agente debe
-- dejar el resultado (venta, cotización, soporte, reclamo…) y sus
-- notas. Eso alimenta los reportes por disposición y el tiempo de
-- cierre (wrap-up).
--
-- Añade a `call_sessions`:
--   disposition          — resultado tipado (NULL = sin clasificar)
--   notes                — notas libres del agente
--   wrap_up_completed_at — cuándo guardó la disposición
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS disposition TEXT;

ALTER TABLE call_sessions
  DROP CONSTRAINT IF EXISTS call_sessions_disposition_check;
ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_disposition_check
  CHECK (
    disposition IS NULL OR disposition IN (
      'sale',
      'quote',
      'support',
      'complaint',
      'follow_up',
      'not_interested',
      'wrong_number',
      'other'
    )
  );

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS wrap_up_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_call_sessions_account_disposition
  ON call_sessions(account_id, disposition);

NOTIFY pgrst, 'reload schema';
