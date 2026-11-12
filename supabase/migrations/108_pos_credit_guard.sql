-- ============================================================
-- 108_pos_credit_guard.sql — Límite de crédito a nivel de tabla
--
-- La migración 106 valida el límite dentro de pos_sale_checkout(),
-- pero pos_create_sale() sigue siendo ejecutable por sí sola y un
-- cliente podría adjuntar después un cliente del POS a una venta a
-- crédito sin pasar por esa validación.
--
-- Esta migración reemplaza pos_guard_sale() para que el límite se
-- compruebe también en la tabla:
--   * al insertar una venta con saldo y cliente del POS;
--   * al adjuntar un cliente del POS a una venta con saldo;
--   * al aumentar el saldo de una venta ya asociada.
--
-- No bloquea los abonos: cuando el saldo baja, la condición de
-- aumento no se cumple y la cobranza sigue funcionando aunque el
-- cliente ya estuviera por encima de su límite.
--
-- Requiere 106_pos_permissions.sql. Idempotente.
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.pos_require_for(uuid,text)') IS NULL THEN
    RAISE EXCEPTION
      '108_pos_credit_guard.sql requiere aplicar antes 106_pos_permissions.sql';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pos_guard_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit NUMERIC;
  v_debt NUMERIC;
  -- En INSERT, OLD no está asignado. Se copian sus campos dentro de
  -- un IF para no referenciar el registro en la rama de inserción.
  v_old_balance NUMERIC := 0;
  v_old_discount NUMERIC := 0;
  v_old_customer UUID := NULL;
  v_old_status TEXT := '';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_balance := COALESCE(OLD.balance_usd, 0);
    v_old_discount := COALESCE(OLD.discount_usd, 0);
    v_old_customer := OLD.pos_customer_id;
    v_old_status := COALESCE(OLD.status, '');
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM pos_require_for(NEW.account_id, 'sell');
  ELSIF NEW.status = 'void' AND v_old_status <> 'void' THEN
    PERFORM pos_require_for(NEW.account_id, 'void_sales');
  END IF;

  -- La venta nace en 'paid' con saldo 0 y la RPC actualiza los
  -- totales al final: el cambio de saldo es la señal real de que
  -- se está fiando.
  IF COALESCE(NEW.balance_usd, 0) > 0.005
     AND (TG_OP = 'INSERT' OR v_old_balance <= 0.005) THEN
    PERFORM pos_require_for(NEW.account_id, 'sell_credit');
  END IF;

  IF COALESCE(NEW.discount_usd, 0) > 0.005
     AND (TG_OP = 'INSERT' OR v_old_discount <= 0.005) THEN
    PERFORM pos_require_for(NEW.account_id, 'apply_discount');
  END IF;

  -- Guarda del límite: solo cuando el saldo nace, se asocia el
  -- cliente o el saldo sube. Un abono nunca entra aquí.
  IF COALESCE(NEW.balance_usd, 0) > 0.005
     AND NEW.pos_customer_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.pos_customer_id IS DISTINCT FROM v_old_customer
       OR COALESCE(NEW.balance_usd, 0) > v_old_balance + 0.005
     ) THEN

    SELECT credit_limit_usd INTO v_limit
      FROM pos_customers
     WHERE id = NEW.pos_customer_id
       AND account_id = NEW.account_id;

    IF v_limit IS NOT NULL THEN
      SELECT COALESCE(SUM(balance_usd), 0) INTO v_debt
        FROM pos_sales
       WHERE account_id = NEW.account_id
         AND pos_customer_id = NEW.pos_customer_id
         AND status = 'credit'
         AND id <> NEW.id;

      IF v_debt + NEW.balance_usd > v_limit + 0.005 THEN
        RAISE EXCEPTION
          'El cliente supera su límite de crédito. Límite: %, saldo usado: %, disponible: %',
          v_limit,
          ROUND(v_debt, 2),
          GREATEST(ROUND(v_limit - v_debt, 2), 0);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_sale_capabilities ON pos_sales;
CREATE TRIGGER guard_sale_capabilities
  BEFORE INSERT OR UPDATE ON pos_sales
  FOR EACH ROW EXECUTE FUNCTION pos_guard_sale();

NOTIFY pgrst, 'reload schema';
