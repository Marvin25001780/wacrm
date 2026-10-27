-- ============================================================
-- 095_pos_change.sql — Vuelto de ventas
--
-- Guarda el cambio entregado para mostrarlo en el recibo. Los pagos
-- se siguen registrando por el monto aplicado, no por el billete
-- recibido, para no inflar el IGTF ni el arqueo.
--
-- Idempotente.
-- ============================================================

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS change_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS change_bs NUMERIC(14,2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
