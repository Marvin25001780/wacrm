-- ============================================================
-- 089_pos_catalog.sql — Campos del catálogo
--
-- Categorías con color y estado; productos con código de barras,
-- descripción y control de inventario.
--
-- Idempotente.
-- ============================================================

ALTER TABLE pos_categories
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE pos_products
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS track_inventory BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_pos_products_barcode
  ON pos_products(account_id, barcode) WHERE barcode IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.pos_categories,
  public.pos_products
TO authenticated;

NOTIFY pgrst, 'reload schema';
