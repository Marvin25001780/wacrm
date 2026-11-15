-- ============================================================
-- 116_queue_max_wait.sql — ACD: espera máxima en cola
--
-- Un contact center perfecto necesita un SLA de atención: si la
-- entrante sigue sonando más allá del máximo configurado, la cola
-- la retira y la marca como perdida (timeout de cola).
--
-- Añade a `telephony_config`:
--   queue_max_wait_seconds — máximo de espera en cola antes de
--     pasarla (espera de la llamada entrante sin agente). Rango
--     0–3600 segundos. `0` = sin límite (espera indefinida).
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

ALTER TABLE telephony_config
  ADD COLUMN IF NOT EXISTS queue_max_wait_seconds INTEGER NOT NULL DEFAULT 60;

ALTER TABLE telephony_config
  DROP CONSTRAINT IF EXISTS telephony_config_queue_max_wait_check;
ALTER TABLE telephony_config
  ADD CONSTRAINT telephony_config_queue_max_wait_check
  CHECK (queue_max_wait_seconds >= 0 AND queue_max_wait_seconds <= 3600);

NOTIFY pgrst, 'reload schema';
