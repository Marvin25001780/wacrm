-- ============================================================
-- 092_pos_price_lists.sql — Canales de precio
--
-- * Cada negocio tiene una lista "Principal" por defecto.
-- * Los demás canales (Mayorista, Delivery...) guardan su precio en
--   pos_product_prices; si no hay precio propio, usan el principal.
-- * La venta guarda el canal con el que se cobró.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Canales
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_price_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pos_price_lists_account
  ON pos_price_lists(account_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_price_lists_one_default
  ON pos_price_lists(account_id) WHERE is_default;

ALTER TABLE pos_price_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_price_lists_select ON pos_price_lists;
DROP POLICY IF EXISTS pos_price_lists_write ON pos_price_lists;
CREATE POLICY pos_price_lists_select ON pos_price_lists
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_price_lists_write ON pos_price_lists
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 2. Precio por producto y canal
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES pos_products(id) ON DELETE CASCADE,
  price_list_id UUID NOT NULL REFERENCES pos_price_lists(id) ON DELETE CASCADE,
  price_usd NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (price_usd >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, price_list_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_product_prices_list
  ON pos_product_prices(account_id, price_list_id);

ALTER TABLE pos_product_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_product_prices_select ON pos_product_prices;
DROP POLICY IF EXISTS pos_product_prices_write ON pos_product_prices;
CREATE POLICY pos_product_prices_select ON pos_product_prices
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_product_prices_write ON pos_product_prices
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Producto y canal deben ser del mismo negocio.
CREATE OR REPLACE FUNCTION pos_product_price_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pos_products
     WHERE id = NEW.product_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'El producto no pertenece al negocio';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pos_price_lists
     WHERE id = NEW.price_list_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'El canal no pertenece al negocio';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_product_price_check ON pos_product_prices;
CREATE TRIGGER pos_product_price_check
  BEFORE INSERT OR UPDATE ON pos_product_prices
  FOR EACH ROW EXECUTE FUNCTION pos_product_price_check();

-- ------------------------------------------------------------
-- 3. La venta guarda el canal
-- ------------------------------------------------------------
ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS price_list_id UUID REFERENCES pos_price_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_sales_price_list
  ON pos_sales(price_list_id);

-- ------------------------------------------------------------
-- 4. Canal Principal para los negocios existentes y nuevos
-- ------------------------------------------------------------
INSERT INTO pos_price_lists (account_id, name, is_default)
SELECT id, 'Principal', TRUE FROM accounts
ON CONFLICT (account_id, name) DO NOTHING;

-- Si un canal Principal quedó sin ser el predeterminado, se corrige.
UPDATE pos_price_lists l
   SET is_default = TRUE
 WHERE l.name = 'Principal'
   AND NOT EXISTS (
     SELECT 1 FROM pos_price_lists d
      WHERE d.account_id = l.account_id AND d.is_default
   );

CREATE OR REPLACE FUNCTION pos_seed_price_list()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO pos_price_lists (account_id, name, is_default)
  VALUES (NEW.id, 'Principal', TRUE)
  ON CONFLICT (account_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_seed_price_list ON accounts;
CREATE TRIGGER pos_seed_price_list
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION pos_seed_price_list();

-- ------------------------------------------------------------
-- 5. Permisos
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.pos_price_lists,
  public.pos_product_prices
TO authenticated;

NOTIFY pgrst, 'reload schema';
