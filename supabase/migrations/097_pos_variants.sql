-- ============================================================
-- 097_pos_variants.sql — Variantes de producto
--
-- Cada variante es un producto hijo con su propio stock, SKU,
-- código de barras y precio. El producto padre queda como
-- contenedor y no se vende.
--
-- Idempotente.
-- ============================================================

ALTER TABLE pos_products
  ADD COLUMN IF NOT EXISTS parent_product_id UUID
    REFERENCES pos_products(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_parent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS variant_label TEXT;

CREATE INDEX IF NOT EXISTS idx_pos_products_parent
  ON pos_products(account_id, parent_product_id)
  WHERE parent_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_products_is_parent
  ON pos_products(account_id, is_parent);

NOTIFY pgrst, 'reload schema';
