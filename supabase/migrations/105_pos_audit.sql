-- ============================================================
-- 105_pos_audit.sql — Bitácora del POS
--
-- `audit_logs` y `audit_row()` ya existían (migración 041) y la
-- sección Bitácora de Ajustes ya consultaba la tabla, pero el POS
-- no tenía triggers: por eso siempre salía vacía.
--
-- Este archivo engancha el trigger genérico a las tablas del POS.
-- audit_row() resuelve account_id y descarta columnas sensibles,
-- así que no hay lógica nueva que mantener.
--
-- Idempotente.
-- ============================================================

DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY[
    'pos_settings',
    'pos_categories',
    'pos_products',
    'pos_customers',
    'pos_sales',
    'pos_sale_items',
    'pos_sale_payments',
    'pos_sale_returns',
    'pos_sale_return_items',
    'pos_inventory_docs',
    'pos_inventory_doc_items',
    'pos_inventory_movements',
    'pos_transactions',
    'pos_accounts',
    'pos_shifts',
    'pos_registers',
    'pos_price_lists',
    'pos_product_prices',
    'pos_discounts',
    'pos_surcharges',
    'pos_sale_channels',
    'pos_fixed_expenses',
    'pos_fixed_expense_payments',
    'pos_fiscal_credit_notes',
    'pos_supplier_payments',
    'pos_permissions'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    -- Algunas tablas llegaron en migraciones posteriores; si el
    -- negocio aún no las tiene, se omiten sin romper la ejecución.
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_%I ON %I', t, t
    );
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION public.audit_row()',
      t, t
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
