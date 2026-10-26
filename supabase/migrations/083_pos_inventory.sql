-- ============================================================
-- 083_pos_inventory.sql — Compras, ajustes y mermas
--
-- Todas las operaciones son atómicas (RPC SECURITY DEFINER),
-- validan la pertenencia a la cuenta y dejan movimiento de
-- inventario para poder auditar el stock.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- Registrar una compra: suma existencias y recalcula el costo
-- medio ponderado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_register_purchase(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_user UUID := auth.uid();
  v_product RECORD;
  v_new_stock NUMERIC;
  v_new_cost NUMERIC;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_user LIMIT 1;
  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor que cero';
  END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'El costo no puede ser negativo';
  END IF;

  SELECT * INTO v_product
    FROM pos_products
   WHERE id = p_product_id AND account_id = v_account
   FOR UPDATE;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;
  IF v_product.kind = 'service' THEN
    RAISE EXCEPTION 'Un servicio no lleva inventario';
  END IF;

  v_new_stock := v_product.stock + p_quantity;

  -- Costo medio ponderado: (stock actual × costo actual + compra × costo compra) / stock nuevo.
  IF v_new_stock > 0 THEN
    v_new_cost := ROUND(
      ((v_product.stock * v_product.cost_usd) + (p_quantity * p_unit_cost)) / v_new_stock,
      2
    );
  ELSE
    v_new_cost := v_product.cost_usd;
  END IF;

  UPDATE pos_products
     SET stock = v_new_stock,
         cost_usd = v_new_cost,
         updated_at = NOW()
   WHERE id = p_product_id;

  INSERT INTO pos_inventory_movements (
    account_id, product_id, kind, quantity, unit_cost_usd, note, created_by
  ) VALUES (
    v_account, p_product_id, 'purchase', p_quantity, p_unit_cost, p_note, v_user
  );

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'stock', v_new_stock,
    'cost_usd', v_new_cost
  );
END;
$$;

-- ------------------------------------------------------------
-- Ajuste por conteo físico: fija la existencia al valor contado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_adjust_stock(
  p_product_id UUID,
  p_counted NUMERIC,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_user UUID := auth.uid();
  v_product RECORD;
  v_diff NUMERIC;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_user LIMIT 1;
  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_counted IS NULL OR p_counted < 0 THEN
    RAISE EXCEPTION 'La existencia contada no puede ser negativa';
  END IF;

  SELECT * INTO v_product
    FROM pos_products
   WHERE id = p_product_id AND account_id = v_account
   FOR UPDATE;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;
  IF v_product.kind = 'service' THEN
    RAISE EXCEPTION 'Un servicio no lleva inventario';
  END IF;

  v_diff := p_counted - v_product.stock;
  IF v_diff = 0 THEN
    RAISE EXCEPTION 'La existencia contada es igual a la actual';
  END IF;

  UPDATE pos_products
     SET stock = p_counted,
         updated_at = NOW()
   WHERE id = p_product_id;

  INSERT INTO pos_inventory_movements (
    account_id, product_id, kind, quantity, unit_cost_usd, note, created_by
  ) VALUES (
    v_account, p_product_id, 'adjustment', v_diff, v_product.cost_usd, p_note, v_user
  );

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'stock', p_counted,
    'difference', v_diff
  );
END;
$$;

-- ------------------------------------------------------------
-- Merma o salida sin venta: resta existencias y se registra
-- como pérdida de inventario.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_register_loss(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_user UUID := auth.uid();
  v_product RECORD;
  v_new_stock NUMERIC;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_user LIMIT 1;
  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor que cero';
  END IF;

  SELECT * INTO v_product
    FROM pos_products
   WHERE id = p_product_id AND account_id = v_account
   FOR UPDATE;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;
  IF v_product.stock < p_quantity THEN
    RAISE EXCEPTION 'Stock insuficiente (disponible %)', v_product.stock;
  END IF;

  v_new_stock := v_product.stock - p_quantity;

  UPDATE pos_products
     SET stock = v_new_stock,
         updated_at = NOW()
   WHERE id = p_product_id;

  INSERT INTO pos_inventory_movements (
    account_id, product_id, kind, quantity, unit_cost_usd, note, created_by
  ) VALUES (
    v_account, p_product_id, 'loss', -p_quantity, v_product.cost_usd, p_note, v_user
  );

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'stock', v_new_stock
  );
END;
$$;

GRANT EXECUTE ON FUNCTION pos_register_purchase(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_adjust_stock(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_register_loss(UUID, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
