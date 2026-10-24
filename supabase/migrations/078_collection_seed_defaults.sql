-- ============================================================
-- 078_collection_seed_defaults.sql - Valores por defecto
--
-- Crea la configuración, las 5 políticas por tramo y las reglas
-- de comisión en cero para cada cuenta. Es idempotente.
--
-- Se ejecuta:
--   - al crear una cuenta nueva (trigger),
--   - para todas las cuentas existentes en esta migración.
-- ============================================================

CREATE OR REPLACE FUNCTION collection_seed_account_defaults(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO collection_settings (account_id, country_code, timezone, currency)
  VALUES (p_account_id, 'VE', 'America/Caracas', 'USD')
  ON CONFLICT (account_id) DO NOTHING;

  INSERT INTO collection_policies (
    account_id, tramo, max_discount_pct, max_attempts_per_day,
    ptp_max_days, min_down_payment_pct, target_recovery_pct
  ) VALUES
    (p_account_id, '1_15',   0,  3, 7,  0, 80),
    (p_account_id, '16_30',  5,  3, 7, 10, 70),
    (p_account_id, '31_60', 10,  4, 5, 15, 60),
    (p_account_id, '61_90', 15,  4, 3, 20, 50),
    (p_account_id, '90_plus', 25, 5, 2, 30, 40)
  ON CONFLICT (account_id, tramo) DO NOTHING;

  INSERT INTO collection_commission_rules (account_id, tramo, percentage)
  VALUES
    (p_account_id, '1_15', 0),
    (p_account_id, '16_30', 0),
    (p_account_id, '31_60', 0),
    (p_account_id, '61_90', 0),
    (p_account_id, '90_plus', 0)
  ON CONFLICT (account_id, tramo) DO NOTHING;
END;
$$;

-- Cuentas nuevas.
CREATE OR REPLACE FUNCTION collection_seed_new_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM collection_seed_account_defaults(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_seed_defaults ON accounts;
CREATE TRIGGER collection_seed_defaults
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION collection_seed_new_account();

-- Cuentas existentes.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM accounts LOOP
    PERFORM collection_seed_account_defaults(r.id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION collection_seed_account_defaults(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION collection_seed_account_defaults(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION collection_seed_new_account() TO service_role;

GRANT EXECUTE ON FUNCTION collection_import_commit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION collection_import_cancel(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION collection_recompute_priorities(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION collection_mark_broken_promises(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION collection_resolve_promise(UUID, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION collection_import_commit(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION collection_import_cancel(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION collection_recompute_priorities(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION collection_mark_broken_promises(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION collection_resolve_promise(UUID, TEXT) TO service_role;
