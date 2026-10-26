-- ============================================================
-- 082_pos_core.sql — Punto de venta (Wink-style) dentro del CRM
--
-- Multidivisa: todo se guarda en USD y cada operación conserva la
-- tasa usada, para poder auditar retroactivamente.
--
-- Idempotente. Ejecutar en Supabase (SQL Editor).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Configuración e impuestos por negocio
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  iva_rate NUMERIC(5,2) NOT NULL DEFAULT 16 CHECK (iva_rate >= 0 AND iva_rate <= 100),
  igtf_rate NUMERIC(5,2) NOT NULL DEFAULT 3 CHECK (igtf_rate >= 0 AND igtf_rate <= 100),
  default_rate NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (default_rate >= 0),
  currency_primary TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pos_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_settings_select ON pos_settings;
DROP POLICY IF EXISTS pos_settings_write ON pos_settings;
CREATE POLICY pos_settings_select ON pos_settings
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_settings_write ON pos_settings
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- 2. Tasa de cambio (BCV o manual)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rate_date DATE NOT NULL,
  rate NUMERIC(18,6) NOT NULL CHECK (rate > 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('bcv', 'manual')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, rate_date, source)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_account_date
  ON exchange_rates(account_id, rate_date DESC);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exchange_rates_select ON exchange_rates;
DROP POLICY IF EXISTS exchange_rates_write ON exchange_rates;
CREATE POLICY exchange_rates_select ON exchange_rates
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY exchange_rates_write ON exchange_rates
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 3. Catálogo
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

ALTER TABLE pos_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_categories_all ON pos_categories;
CREATE POLICY pos_categories_all ON pos_categories
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS pos_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id UUID REFERENCES pos_categories(id) ON DELETE SET NULL,
  sku TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'product'
    CHECK (kind IN ('product', 'supply', 'service')),
  unit TEXT NOT NULL DEFAULT 'unidad',
  cost_usd NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  price_usd NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (price_usd >= 0),
  stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  min_stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  taxable BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_products_account
  ON pos_products(account_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_products_sku
  ON pos_products(account_id, sku) WHERE sku IS NOT NULL;

ALTER TABLE pos_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_products_select ON pos_products;
DROP POLICY IF EXISTS pos_products_write ON pos_products;
CREATE POLICY pos_products_select ON pos_products
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_products_write ON pos_products
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 4. Ventas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  customer_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'credit', 'void')),
  subtotal_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_iva_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_igtf_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_cost_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  exchange_rate_used NUMERIC(18,6) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, number)
);

CREATE INDEX IF NOT EXISTS idx_pos_sales_account_date
  ON pos_sales(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_sales_customer
  ON pos_sales(account_id, customer_id);

ALTER TABLE pos_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_sales_select ON pos_sales;
DROP POLICY IF EXISTS pos_sales_write ON pos_sales;
CREATE POLICY pos_sales_select ON pos_sales
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_sales_write ON pos_sales
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS pos_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID REFERENCES pos_products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_price_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable BOOLEAN NOT NULL DEFAULT TRUE,
  line_total_usd NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pos_sale_items_sale
  ON pos_sale_items(sale_id);

ALTER TABLE pos_sale_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_sale_items_select ON pos_sale_items;
DROP POLICY IF EXISTS pos_sale_items_write ON pos_sale_items;
CREATE POLICY pos_sale_items_select ON pos_sale_items
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_sale_items_write ON pos_sale_items
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS pos_sale_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  method TEXT NOT NULL
    CHECK (method IN ('cash_usd', 'cash_bs', 'transfer_bs', 'pago_movil', 'zelle', 'card', 'other')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'VES')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  amount_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  rate NUMERIC(18,6) NOT NULL DEFAULT 0,
  igtf_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  reference TEXT
);

CREATE INDEX IF NOT EXISTS idx_pos_sale_payments_sale
  ON pos_sale_payments(sale_id);

ALTER TABLE pos_sale_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_sale_payments_select ON pos_sale_payments;
DROP POLICY IF EXISTS pos_sale_payments_write ON pos_sale_payments;
CREATE POLICY pos_sale_payments_select ON pos_sale_payments
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_sale_payments_write ON pos_sale_payments
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 5. Inventario
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES pos_products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('purchase', 'sale', 'return', 'adjustment', 'loss')),
  quantity NUMERIC(14,3) NOT NULL,
  unit_cost_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  note TEXT,
  sale_id UUID REFERENCES pos_sales(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_inventory_account_date
  ON pos_inventory_movements(account_id, created_at DESC);

ALTER TABLE pos_inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_inventory_all ON pos_inventory_movements;
CREATE POLICY pos_inventory_all ON pos_inventory_movements
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 6. Cuentas y movimientos de dinero
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'cash_usd'
    CHECK (kind IN ('cash_usd', 'cash_bs', 'bank', 'mobile', 'zelle', 'other')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'VES')),
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_accounts_account
  ON pos_accounts(account_id, active);

ALTER TABLE pos_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_accounts_all ON pos_accounts;
CREATE POLICY pos_accounts_all ON pos_accounts
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS pos_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pos_account_id UUID REFERENCES pos_accounts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  category TEXT NOT NULL DEFAULT 'sale'
    CHECK (category IN ('sale', 'purchase', 'expense', 'transfer', 'adjustment', 'other')),
  description TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'VES')),
  amount_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  rate NUMERIC(18,6) NOT NULL DEFAULT 0,
  sale_id UUID REFERENCES pos_sales(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_transactions_account_date
  ON pos_transactions(account_id, created_at DESC);

ALTER TABLE pos_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_transactions_all ON pos_transactions;
CREATE POLICY pos_transactions_all ON pos_transactions
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 7. Auditoría de las tablas sensibles del POS
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_pos_sales ON pos_sales;
CREATE TRIGGER audit_pos_sales
  AFTER INSERT OR UPDATE OR DELETE ON pos_sales
  FOR EACH ROW EXECUTE FUNCTION audit_row();

DROP TRIGGER IF EXISTS audit_pos_products ON pos_products;
CREATE TRIGGER audit_pos_products
  AFTER INSERT OR UPDATE OR DELETE ON pos_products
  FOR EACH ROW EXECUTE FUNCTION audit_row();

DROP TRIGGER IF EXISTS audit_pos_accounts ON pos_accounts;
CREATE TRIGGER audit_pos_accounts
  AFTER INSERT OR UPDATE OR DELETE ON pos_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ------------------------------------------------------------
-- 8. Motor de ventas atómico
--
-- Calcula totales en el servidor (no confía en el cliente),
-- bloquea el correlativo por cuenta, descuenta stock y registra
-- el movimiento de inventario. Devuelve el id de la venta.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_create_sale(
  p_items JSONB,
  p_payments JSONB DEFAULT '[]'::jsonb,
  p_customer_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_rate NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_user UUID := auth.uid();
  v_iva NUMERIC := 16;
  v_igtf_rate NUMERIC := 3;
  v_subtotal NUMERIC := 0;
  v_discount NUMERIC := 0;
  v_iva_total NUMERIC := 0;
  v_igtf_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_paid NUMERIC := 0;
  v_cost NUMERIC := 0;
  v_number INTEGER;
  v_sale UUID;
  v_item JSONB;
  v_pay JSONB;
  v_rate NUMERIC := p_rate;
  v_product RECORD;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_discount_line NUMERIC;
  v_line NUMERIC;
  v_pay_usd NUMERIC;
  v_pay_igtf NUMERIC;
  v_currency TEXT;
  v_method TEXT;
  v_status TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT account_id INTO v_account
    FROM profiles WHERE user_id = v_user LIMIT 1;

  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta no tiene productos';
  END IF;

  SELECT iva_rate, igtf_rate INTO v_iva, v_igtf_rate
    FROM pos_settings WHERE account_id = v_account;

  IF v_iva IS NULL THEN
    v_iva := 16;
    v_igtf_rate := 3;
    INSERT INTO pos_settings (account_id) VALUES (v_account)
      ON CONFLICT (account_id) DO NOTHING;
  END IF;

  IF v_rate IS NULL OR v_rate <= 0 THEN
    SELECT rate INTO v_rate
      FROM exchange_rates
     WHERE account_id = v_account
     ORDER BY rate_date DESC, created_at DESC
     LIMIT 1;
  END IF;
  v_rate := COALESCE(v_rate, 0);

  -- Correlativo seguro por cuenta.
  PERFORM pg_advisory_xact_lock(hashtext('pos_sale:' || v_account::text));
  SELECT COALESCE(MAX(number), 0) + 1 INTO v_number
    FROM pos_sales WHERE account_id = v_account;

  INSERT INTO pos_sales (
    account_id, number, customer_id, user_id, status,
    exchange_rate_used, notes
  ) VALUES (
    v_account, v_number, p_customer_id, v_user, 'paid',
    v_rate, p_notes
  ) RETURNING id INTO v_sale;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product
      FROM pos_products
     WHERE id = (v_item->>'product_id')::uuid
       AND account_id = v_account;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_item->>'product_id';
    END IF;

    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para %', v_product.name;
    END IF;

    v_price := COALESCE((v_item->>'unit_price_usd')::numeric, v_product.price_usd);
    v_discount_line := COALESCE((v_item->>'discount_usd')::numeric, 0);
    v_line := ROUND(v_qty * v_price - v_discount_line, 2);

    IF v_line < 0 THEN
      RAISE EXCEPTION 'Descuento mayor que el precio en %', v_product.name;
    END IF;

    INSERT INTO pos_sale_items (
      sale_id, account_id, product_id, name, quantity,
      unit_cost_usd, unit_price_usd, discount_usd, taxable, line_total_usd
    ) VALUES (
      v_sale, v_account, v_product.id, v_product.name, v_qty,
      v_product.cost_usd, v_price, v_discount_line, v_product.taxable, v_line
    );

    v_subtotal := v_subtotal + v_line;
    v_discount := v_discount + v_discount_line;
    v_cost := v_cost + ROUND(v_qty * v_product.cost_usd, 2);

    IF v_product.taxable THEN
      v_iva_total := v_iva_total + ROUND(v_line * v_iva / 100, 2);
    END IF;

    IF v_product.kind = 'product' THEN
      IF v_product.stock < v_qty THEN
        RAISE EXCEPTION 'Stock insuficiente de % (disponible %)',
          v_product.name, v_product.stock;
      END IF;

      UPDATE pos_products
         SET stock = stock - v_qty,
             updated_at = NOW()
       WHERE id = v_product.id;

      INSERT INTO pos_inventory_movements (
        account_id, product_id, kind, quantity, unit_cost_usd, sale_id, created_by
      ) VALUES (
        v_account, v_product.id, 'sale', -v_qty, v_product.cost_usd, v_sale, v_user
      );
    END IF;
  END LOOP;

  -- Pagos: IGTF solo sobre pagos en divisa (USD).
  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_method := COALESCE(v_pay->>'method', 'other');
    v_currency := COALESCE(v_pay->>'currency', 'USD');
    v_pay_usd := COALESCE((v_pay->>'amount_usd')::numeric, 0);

    IF v_pay_usd <= 0 THEN
      RAISE EXCEPTION 'Pago inválido';
    END IF;

    v_pay_igtf := CASE WHEN v_currency = 'USD'
      THEN ROUND(v_pay_usd * v_igtf_rate / 100, 2)
      ELSE 0 END;

    INSERT INTO pos_sale_payments (
      sale_id, account_id, method, currency, amount, amount_usd, rate, igtf_usd, reference
    ) VALUES (
      v_sale, v_account, v_method, v_currency,
      COALESCE((v_pay->>'amount')::numeric, v_pay_usd),
      v_pay_usd, v_rate, v_pay_igtf, v_pay->>'reference'
    );

    v_paid := v_paid + v_pay_usd + v_pay_igtf;
    v_igtf_total := v_igtf_total + v_pay_igtf;
  END LOOP;

  v_total := ROUND(v_subtotal + v_iva_total + v_igtf_total, 2);

  v_status := CASE WHEN v_paid + 0.005 >= v_total THEN 'paid' ELSE 'credit' END;

  UPDATE pos_sales
     SET subtotal_usd = ROUND(v_subtotal, 2),
         discount_usd = ROUND(v_discount, 2),
         tax_iva_usd = ROUND(v_iva_total, 2),
         tax_igtf_usd = ROUND(v_igtf_total, 2),
         total_usd = v_total,
         paid_usd = ROUND(v_paid, 2),
         balance_usd = GREATEST(ROUND(v_total - v_paid, 2), 0),
         unit_cost_usd = ROUND(v_cost, 2),
         status = v_status
   WHERE id = v_sale;

  RETURN jsonb_build_object(
    'sale_id', v_sale,
    'number', v_number,
    'subtotal_usd', ROUND(v_subtotal, 2),
    'tax_iva_usd', ROUND(v_iva_total, 2),
    'tax_igtf_usd', ROUND(v_igtf_total, 2),
    'total_usd', v_total,
    'paid_usd', ROUND(v_paid, 2),
    'balance_usd', GREATEST(ROUND(v_total - v_paid, 2), 0),
    'status', v_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION pos_create_sale(JSONB, JSONB, UUID, TEXT, NUMERIC)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
