-- ============================================================
-- 053_metrics_sales.sql — Datos para la sección VENTAS.
--
-- El módulo de Métricas necesita reportar VENTAS (ofertas ganadas) y
-- COTIZACIONES (ofertas creadas) por período. La tabla `deals` ya
-- existe; añadimos lo que faltaba:
--
--   1. `deals.product`   — Producto / servicio de la oferta (texto
--      libre, opcional). Habilita la tabla "por producto" del reporte.
--   2. `deals.closed_at` — momento en que la oferta pasó a Ganada o
--      Perdida, mantenido por un trigger (mismo patrón que
--      `conversations.closed_at`, migration 051). Necesario para
--      contar ventas por fecha de cierre real, no por `updated_at`.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. Columnas nuevas en `deals`
-- ============================================================
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS product TEXT;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Índices para las consultas del reporte (creadas / cerradas).
CREATE INDEX IF NOT EXISTS idx_deals_closed_at
  ON deals(account_id, closed_at);

CREATE INDEX IF NOT EXISTS idx_deals_status
  ON deals(account_id, status);

-- ============================================================
-- 2. `deals.closed_at` por trigger
--
-- Al pasar a Ganada/Perdida se sella la fecha (si aún no la tenía);
-- al reabrir una oferta se limpia para no contar un cierre que ya no
-- existe. Cambiar entre Ganada y Perdida conserva la fecha original.
-- ============================================================
CREATE OR REPLACE FUNCTION deals_track_closed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('won', 'lost') THEN
    NEW.closed_at := COALESCE(NEW.closed_at, NOW());
  ELSIF NEW.status = 'open' THEN
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS track_deal_closed_at ON deals;
CREATE TRIGGER track_deal_closed_at BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_track_closed_at();

-- Backfill conservador: ofertas ya ganadas/perdidas sin fecha heredan
-- su última actualización como aproximación del cierre.
UPDATE deals
  SET closed_at = COALESCE(closed_at, updated_at, created_at)
  WHERE status IN ('won', 'lost') AND closed_at IS NULL;
