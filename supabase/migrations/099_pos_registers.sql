-- ============================================================
-- 099_pos_registers.sql — Varias cajas por negocio
--
-- * Cada negocio tiene cajas (Caja 01, Caja 02...).
-- * Cada caja tiene su propio turno abierto y su arqueo.
-- * Un cajero solo puede tener un turno abierto a la vez.
-- * El inventario y las cuentas de Finanzas siguen siendo del negocio.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_registers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pos_registers_account
  ON pos_registers(account_id, active);

ALTER TABLE pos_registers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_registers_select ON pos_registers;
DROP POLICY IF EXISTS pos_registers_write ON pos_registers;
CREATE POLICY pos_registers_select ON pos_registers
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pos_registers_write ON pos_registers
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

INSERT INTO pos_registers (account_id, name, active)
SELECT id, 'Caja 01', TRUE FROM accounts
ON CONFLICT (account_id, name) DO NOTHING;

CREATE OR REPLACE FUNCTION pos_seed_register()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO pos_registers (account_id, name, active)
  VALUES (NEW.id, 'Caja 01', TRUE)
  ON CONFLICT (account_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_seed_register ON accounts;
CREATE TRIGGER pos_seed_register
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION pos_seed_register();

-- ------------------------------------------------------------
-- Turnos por caja
-- ------------------------------------------------------------
ALTER TABLE pos_shifts
  ADD COLUMN IF NOT EXISTS register_id UUID
    REFERENCES pos_registers(id) ON DELETE SET NULL;

UPDATE pos_shifts s
   SET register_id = (
     SELECT r.id FROM pos_registers r
      WHERE r.account_id = s.account_id
      ORDER BY r.created_at, r.name
      LIMIT 1
   )
 WHERE s.register_id IS NULL;

DROP INDEX IF EXISTS idx_pos_shifts_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_shifts_one_open_register
  ON pos_shifts(register_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_pos_shifts_register
  ON pos_shifts(account_id, register_id, opened_at DESC);

-- La venta se liga al turno abierto del cajero, no a una caja cualquiera.
CREATE OR REPLACE FUNCTION pos_sales_assign_shift()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.shift_id IS NULL THEN
    SELECT id INTO NEW.shift_id
      FROM pos_shifts
     WHERE account_id = NEW.account_id
       AND status = 'open'
       AND opened_by = NEW.user_id
     ORDER BY opened_at DESC
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_sales_assign_shift ON pos_sales;
CREATE TRIGGER pos_sales_assign_shift
  BEFORE INSERT ON pos_sales
  FOR EACH ROW EXECUTE FUNCTION pos_sales_assign_shift();

DROP FUNCTION IF EXISTS pos_open_shift(NUMERIC, NUMERIC, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION pos_open_shift(
  p_opening_usd NUMERIC DEFAULT 0,
  p_opening_bs NUMERIC DEFAULT 0,
  p_rate NUMERIC DEFAULT 0,
  p_note TEXT DEFAULT NULL,
  p_register_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_user UUID := auth.uid();
  v_number INTEGER;
  v_shift UUID;
  v_rate NUMERIC := COALESCE(p_rate, 0);
  v_register UUID;
  v_register_name TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT account_id INTO v_account
    FROM profiles WHERE user_id = v_user LIMIT 1;

  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF COALESCE(p_opening_usd, 0) < 0 OR COALESCE(p_opening_bs, 0) < 0 THEN
    RAISE EXCEPTION 'El fondo inicial no puede ser negativo';
  END IF;

  IF p_register_id IS NULL THEN
    SELECT id, name INTO v_register, v_register_name
      FROM pos_registers
     WHERE account_id = v_account AND active
     ORDER BY created_at, name
     LIMIT 1;
  ELSE
    SELECT id, name INTO v_register, v_register_name
      FROM pos_registers
     WHERE id = p_register_id AND account_id = v_account AND active;
  END IF;

  IF v_register IS NULL THEN
    RAISE EXCEPTION 'Caja no válida o inactiva';
  END IF;

  IF v_rate <= 0 THEN
    SELECT rate INTO v_rate
      FROM exchange_rates
     WHERE account_id = v_account
     ORDER BY rate_date DESC, created_at DESC
     LIMIT 1;
  END IF;
  v_rate := COALESCE(v_rate, 0);

  PERFORM pg_advisory_xact_lock(hashtext('pos_shift:' || v_account::text));

  IF EXISTS (
    SELECT 1 FROM pos_shifts
     WHERE account_id = v_account AND status = 'open' AND register_id = v_register
  ) THEN
    RAISE EXCEPTION 'La caja % ya tiene un turno abierto', v_register_name;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pos_shifts
     WHERE account_id = v_account AND status = 'open' AND opened_by = v_user
  ) THEN
    RAISE EXCEPTION 'Ya tienes un turno abierto';
  END IF;

  SELECT COALESCE(MAX(number), 0) + 1 INTO v_number
    FROM pos_shifts WHERE account_id = v_account;

  INSERT INTO pos_shifts (
    account_id, register_id, number, opened_by,
    opening_usd, opening_bs, rate_open, notes_open
  ) VALUES (
    v_account, v_register, v_number, v_user,
    COALESCE(p_opening_usd, 0), COALESCE(p_opening_bs, 0), v_rate, p_note
  ) RETURNING id INTO v_shift;

  RETURN jsonb_build_object(
    'shift_id', v_shift,
    'number', v_number,
    'register_id', v_register,
    'register_name', v_register_name,
    'rate', v_rate
  );
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pos_registers TO authenticated;
GRANT EXECUTE ON FUNCTION pos_open_shift(
  NUMERIC, NUMERIC, NUMERIC, TEXT, UUID
) TO authenticated;

NOTIFY pgrst, 'reload schema';
