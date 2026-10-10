-- ============================================================
-- 043_broadcast_scheduling.sql — Programación de campañas masivas
--
-- `broadcasts` ya tiene `scheduled_at` y el estado 'scheduled'
-- (migración base). Aquí añadimos:
--   * header_media_url — la URL de medios del encabezado que el
--     asistente recopila; se persiste para que el worker nocturno
--     pueda reconstruir el envío exactamente igual que el envío
--     inmediato (antes solo vivía en memoria del cliente).
--   * índices para el barrido del cron: broadcasts programados
--     vencidos y destinatarios pendientes.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS header_media_url text;

CREATE INDEX IF NOT EXISTS idx_broadcasts_due_scheduled
  ON broadcasts(scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_pending
  ON broadcast_recipients(broadcast_id)
  WHERE status = 'pending';
