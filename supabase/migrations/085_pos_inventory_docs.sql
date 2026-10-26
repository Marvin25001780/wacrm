-- ============================================================
-- 085_pos_inventory_docs.sql — Documentos de inventario
--
-- Compras, devoluciones y ajustes dejan de ser un movimiento
-- suelto y pasan a ser documentos con varias líneas, como en la
-- referencia. Los movimientos siguen siendo el libro mayor y
-- apuntan al documento que los originó.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_inventory_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'return', 'adjustment')),
  adjustment_type TEXT CHECK (adjustment_type IN ('count', 'loss')),
  doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  payment_method TEXT,
  pos_account_id UUID REFERENCES pos_accounts(id) ON DELETE SET NULL,
  invoice_number TEXT,
  note TEXT,
  total_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_inventory_docs_account
  ON pos_inventory_docs(account_id, kind, doc_date DESC);

ALTER TABLE pos_inventory_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_inventory_docs_all ON pos_inventory_docs;
CREATE POLICY pos_inventory_docs_all ON pos_inventory_docs
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS pos_inventory_doc_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES pos_inventory_docs(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID REFERENCES pos_products(id) ON DELETE SET NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit_cost_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total_usd NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pos_inventory_doc_items_doc
  ON pos_inventory_doc_items(doc_id);

ALTER TABLE pos_inventory_doc_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_inventory_doc_items_all ON pos_inventory_doc_items;
CREATE POLICY pos_inventory_doc_items_all ON pos_inventory_doc_items
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

ALTER TABLE pos_inventory_movements
  ADD COLUMN IF NOT EXISTS doc_id UUID REFERENCES pos_inventory_docs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_inventory_movements_doc
  ON pos_inventory_movements(doc_id);

-- ------------------------------------------------------------
-- Compra: documento + líneas + stock + costo medio ponderado.
-- p_payload: { payment_method, pos_account_id, doc_date,
--              invoice_number, note, supplier_id,
--              items: [{ product_id, quantity, unit_cost_usd }] }
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_create_purchase(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_user UUID := auth.uid();
  v_doc UUID;
  v_item JSONB;
  v_product RECORD;
  v_qty NUMERIC;
  v_cost NUMERIC;
  v_total NUMERIC := 0;
  v_new_stock NUMERIC;
  v_new_cost NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_user LIMIT 1;
  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_payload->'items' IS NULL OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'La compra no tiene líneas';
  END IF;

  INSERT INTO pos_inventory_docs (
    account_id, kind, doc_date, supplier_id, payment_method,
    pos_account_id, invoice_number, note, created_by
  ) VALUES (
    v_account,
    'purchase',
    COALESCE((p_payload->>'doc_date')::date, CURRENT_DATE),
    NULLIF(p_payload->>'supplier_id', '')::uuid,
    p_payload->>'payment_method',
    NULLIF(p_payload->>'pos_account_id', '')::uuid,
    p_payload->>'invoice_number',
    p_payload->>'note',
    v_user
  ) RETURNING id INTO v_doc;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    v_cost := COALESCE((v_item->>'unit_cost_usd')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
    IF v_cost < 0 THEN RAISE EXCEPTION 'Costo inválido'; END IF;

    SELECT * INTO v_product
      FROM pos_products
     WHERE id = (v_item->>'product_id')::uuid
       AND account_id = v_account
       FOR UPDATE;

    IF v_product.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_product.kind = 'service' THEN
      RAISE EXCEPTION 'Un servicio no lleva inventario';
    END IF;

    v_new_stock := v_product.stock + v_qty;
    IF v_new_stock > 0 THEN
      v_new_cost := ROUND(
        ((v_product.stock * v_product.cost_usd) + (v_qty * v_cost)) / v_new_stock,
        2
      );
    ELSE
      v_new_cost := v_product.cost_usd;
    END IF;

    UPDATE pos_products
       SET stock = v_new_stock, cost_usd = v_new_cost, updated_at = NOW()
     WHERE id = v_product.id;

    INSERT INTO pos_inventory_doc_items (
      doc_id, account_id, product_id, quantity, unit_cost_usd, line_total_usd
    ) VALUES (
      v_doc, v_account, v_product.id, v_qty, v_cost, ROUND(v_qty * v_cost, 2)
    );

    INSERT INTO pos_inventory_movements (
      account_id, product_id, kind, quantity, unit_cost_usd, doc_id, created_by
    ) VALUES (
      v_account, v_product.id, 'purchase', v_qty, v_cost, v_doc, v_user
    );

    v_total := v_total + ROUND(v_qty * v_cost, 2);
  END LOOP;

  UPDATE pos_inventory_docs SET total_usd = v_total WHERE id = v_doc;

  RETURN jsonb_build_object('doc_id', v_doc, 'total_usd', v_total);
END;
$$;

-- ------------------------------------------------------------
-- Devolución a proveedor: resta stock y deja documento.
-- p_payload: { doc_date, invoice_number, note, items:
--              [{ product_id, quantity, unit_cost_usd }] }
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_create_return(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_user UUID := auth.uid();
  v_doc UUID;
  v_item JSONB;
  v_product RECORD;
  v_qty NUMERIC;
  v_cost NUMERIC;
  v_total NUMERIC := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_user LIMIT 1;
  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_payload->'items' IS NULL OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'La devolución no tiene líneas';
  END IF;

  INSERT INTO pos_inventory_docs (
    account_id, kind, doc_date, supplier_id, invoice_number, note, created_by
  ) VALUES (
    v_account, 'return',
    COALESCE((p_payload->>'doc_date')::date, CURRENT_DATE),
    NULLIF(p_payload->>'supplier_id', '')::uuid,
    p_payload->>'invoice_number',
    p_payload->>'note',
    v_user
  ) RETURNING id INTO v_doc;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    v_cost := COALESCE((v_item->>'unit_cost_usd')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;

    SELECT * INTO v_product
      FROM pos_products
     WHERE id = (v_item->>'product_id')::uuid
       AND account_id = v_account
       FOR UPDATE;

    IF v_product.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_product.stock < v_qty THEN
      RAISE EXCEPTION 'Stock insuficiente de % (disponible %)',
        v_product.name, v_product.stock;
    END IF;

    UPDATE pos_products
       SET stock = stock - v_qty, updated_at = NOW()
     WHERE id = v_product.id;

    INSERT INTO pos_inventory_doc_items (
      doc_id, account_id, product_id, quantity, unit_cost_usd, line_total_usd
    ) VALUES (
      v_doc, v_account, v_product.id, -v_qty, v_cost, ROUND(v_qty * v_cost, 2)
    );

    INSERT INTO pos_inventory_movements (
      account_id, product_id, kind, quantity, unit_cost_usd, doc_id, created_by
    ) VALUES (
      v_account, v_product.id, 'return', -v_qty, v_cost, v_doc, v_user
    );

    v_total := v_total + ROUND(v_qty * v_cost, 2);
  END LOOP;

  UPDATE pos_inventory_docs SET total_usd = v_total WHERE id = v_doc;
  RETURN jsonb_build_object('doc_id', v_doc, 'total_usd', v_total);
END;
$$;

-- ------------------------------------------------------------
-- Ajuste de inventario: conteo físico o merma.
-- p_payload: { type: 'count'|'loss', note, doc_date,
--              items: [{ product_id, value }] }
--   count -> value = existencia contada
--   loss  -> value = cantidad a restar
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_create_adjustment(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_user UUID := auth.uid();
  v_doc UUID;
  v_type TEXT := COALESCE(p_payload->>'type', 'count');
  v_item JSONB;
  v_product RECORD;
  v_value NUMERIC;
  v_diff NUMERIC;
  v_kind TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_user LIMIT 1;
  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_type NOT IN ('count', 'loss') THEN
    RAISE EXCEPTION 'Tipo de ajuste inválido';
  END IF;

  IF p_payload->'items' IS NULL OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'El ajuste no tiene líneas';
  END IF;

  INSERT INTO pos_inventory_docs (
    account_id, kind, adjustment_type, doc_date, note, created_by
  ) VALUES (
    v_account, 'adjustment', v_type,
    COALESCE((p_payload->>'doc_date')::date, CURRENT_DATE),
    p_payload->>'note',
    v_user
  ) RETURNING id INTO v_doc;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_value := COALESCE((v_item->>'value')::numeric, 0);
    IF v_value < 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;

    SELECT * INTO v_product
      FROM pos_products
     WHERE id = (v_item->>'product_id')::uuid
       AND account_id = v_account
       FOR UPDATE;

    IF v_product.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_product.kind = 'service' THEN
      RAISE EXCEPTION 'Un servicio no lleva inventario';
    END IF;

    IF v_type = 'count' THEN
      v_diff := v_value - v_product.stock;
      IF v_diff = 0 THEN CONTINUE; END IF;
    ELSE
      IF v_product.stock < v_value THEN
        RAISE EXCEPTION 'Stock insuficiente de % (disponible %)',
          v_product.name, v_product.stock;
      END IF;
      v_diff := -v_value;
    END IF;

    UPDATE pos_products
       SET stock = stock + v_diff, updated_at = NOW()
     WHERE id = v_product.id;

    INSERT INTO pos_inventory_doc_items (
      doc_id, account_id, product_id, quantity, unit_cost_usd, line_total_usd
    ) VALUES (
      v_doc, v_account, v_product.id, v_diff,
      v_product.cost_usd, ROUND(ABS(v_diff) * v_product.cost_usd, 2)
    );

    v_kind := CASE WHEN v_type = 'count' THEN 'adjustment' ELSE 'loss' END;

    INSERT INTO pos_inventory_movements (
      account_id, product_id, kind, quantity, unit_cost_usd, doc_id, created_by
    ) VALUES (
      v_account, v_product.id, v_kind, v_diff,
      v_product.cost_usd, v_doc, v_user
    );
  END LOOP;

  RETURN jsonb_build_object('doc_id', v_doc);
END;
$$;

GRANT EXECUTE ON FUNCTION pos_create_purchase(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_create_return(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_create_adjustment(JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
