-- ============================================================
-- 088_pos_customers.sql — Clientes propios del POS
--
-- El POS deja de usar `contacts` del CRM: tiene su propia agenda
-- de clientes, aislada por negocio. Las ventas pueden apuntar a un
-- cliente del POS sin afectar el CRM.
--
-- También repite los GRANT del POS para evitar el error
-- "permission denied for table" en escrituras desde el navegador.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_customers_account
  ON pos_customers(account_id, active);
CREATE INDEX IF NOT EXISTS idx_pos_customers_name
  ON pos_customers(account_id, name);

ALTER TABLE pos_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_customers_select ON pos_customers;
DROP POLICY IF EXISTS pos_customers_write ON pos_customers;
CREATE POLICY pos_customers_select ON pos_customers
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_customers_write ON pos_customers
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Vínculo de la venta con el cliente del POS (el de contacts queda nulo).
ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS pos_customer_id UUID REFERENCES pos_customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_sales_pos_customer
  ON pos_sales(account_id, pos_customer_id);

-- Permisos de tabla para el rol autenticado (RLS no concede permisos).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.pos_settings,
  public.exchange_rates,
  public.pos_categories,
  public.pos_products,
  public.pos_sales,
  public.pos_sale_items,
  public.pos_sale_payments,
  public.pos_inventory_movements,
  public.pos_inventory_docs,
  public.pos_inventory_doc_items,
  public.pos_accounts,
  public.pos_transactions,
  public.pos_customers
TO authenticated;

GRANT ALL ON TABLE
  public.pos_settings,
  public.exchange_rates,
  public.pos_categories,
  public.pos_products,
  public.pos_sales,
  public.pos_sale_items,
  public.pos_sale_payments,
  public.pos_inventory_movements,
  public.pos_inventory_docs,
  public.pos_inventory_doc_items,
  public.pos_accounts,
  public.pos_transactions,
  public.pos_customers
TO service_role;

NOTIFY pgrst, 'reload schema';
