-- ============================================================
-- 102_pos_sale_channels.sql — Canal de venta
--
-- * Separa "canal de venta" (Tienda, Delivery, Mostrador...) de la
--   lista de precios, que hasta ahora se usaba para las dos cosas.
-- * Cada negocio arranca con Tienda (predeterminado) y Delivery.
-- * La venta guarda el canal con el que se registró.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Canales de venta
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_sale_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pos_sale_channels_account
  ON pos_sale_channels(account_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_sale_channels_one_default
  ON pos_sale_channels(account_id) WHERE is_default;

ALTER TABLE pos_sale_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_sale_channels_select ON pos_sale_channels;
DROP POLICY IF EXISTS pos_sale_channels_write ON pos_sale_channels;
CREATE POLICY pos_sale_channels_select ON pos_sale_channels
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_sale_channels_write ON pos_sale_channels
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 2. La venta guarda el canal
-- ------------------------------------------------------------
ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS sale_channel_id UUID
    REFERENCES pos_sale_channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_sales_sale_channel
  ON pos_sales(account_id, sale_channel_id);

-- ------------------------------------------------------------
-- 3. Canales iniciales para los negocios existentes y nuevos
-- ------------------------------------------------------------
INSERT INTO pos_sale_channels (account_id, name, is_default)
SELECT id, 'Tienda', TRUE FROM accounts
ON CONFLICT (account_id, name) DO NOTHING;

INSERT INTO pos_sale_channels (account_id, name, is_default)
SELECT id, 'Delivery', FALSE FROM accounts
ON CONFLICT (account_id, name) DO NOTHING;

-- Si un negocio quedó sin predeterminado, se marca Tienda.
UPDATE pos_sale_channels c
   SET is_default = TRUE
 WHERE c.name = 'Tienda'
   AND NOT EXISTS (
     SELECT 1 FROM pos_sale_channels d
      WHERE d.account_id = c.account_id AND d.is_default
   );

-- ------------------------------------------------------------
-- 4. Permisos
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pos_sale_channels
TO authenticated;

NOTIFY pgrst, 'reload schema';
