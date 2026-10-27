-- ============================================================
-- 091_pos_shifts.sql — Turnos y arqueo de caja
--
-- * Un turno por negocio a la vez, con fondo inicial en USD y Bs.
-- * Cada venta queda ligada al turno abierto (trigger en pos_sales).
-- * El arqueo calcula el efectivo esperado: fondo inicial + cobros en
--   efectivo + movimientos de cuentas de efectivo (gastos, transferencias).
-- * Al cerrar se guardan contado, esperado y diferencia.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Turnos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  opened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  opening_usd NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_usd >= 0),
  opening_bs NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_bs >= 0),
  rate_open NUMERIC(18,6) NOT NULL DEFAULT 0,
  expected_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  expected_bs NUMERIC(14,2) NOT NULL DEFAULT 0,
  counted_usd NUMERIC(14,2),
  counted_bs NUMERIC(14,2),
  difference_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  difference_bs NUMERIC(14,2) NOT NULL DEFAULT 0,
  sales_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  sales_count INTEGER NOT NULL DEFAULT 0,
  by_method JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes_open TEXT,
  notes_close TEXT,
  UNIQUE (account_id, number)
);

CREATE INDEX IF NOT EXISTS idx_pos_shifts_account
  ON pos_shifts(account_id, opened_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_shifts_one_open
  ON pos_shifts(account_id) WHERE status = 'open';

ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_shifts_select ON pos_shifts;
CREATE POLICY pos_shifts_select ON pos_shifts
  FOR SELECT USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- 2. La venta se liga al turno abierto
-- ------------------------------------------------------------
ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES pos_shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_sales_shift
  ON pos_sales(shift_id);

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
     WHERE account_id = NEW.account_id AND status = 'open'
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_sales_assign_shift ON pos_sales;
CREATE TRIGGER pos_sales_assign_shift
  BEFORE INSERT ON pos_sales
  FOR EACH ROW EXECUTE FUNCTION pos_sales_assign_shift();

-- ------------------------------------------------------------
-- 3. Resumen del turno (esperado y cobros por método)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_shift_summary(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_shift RECORD;
  v_sales_usd NUMERIC := 0;
  v_sales_count INTEGER := 0;
  v_cash_usd NUMERIC := 0;
  v_cash_bs NUMERIC := 0;
  v_tx RECORD;
  v_by_method JSONB := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_shift FROM pos_shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Turno no encontrado';
  END IF;
  IF NOT is_account_member(v_shift.account_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT COALESCE(SUM(total_usd), 0), COUNT(*)
    INTO v_sales_usd, v_sales_count
    FROM pos_sales
   WHERE shift_id = p_shift_id
     AND account_id = v_shift.account_id
     AND status <> 'void';

  SELECT COALESCE(SUM(p.amount_usd + p.igtf_usd), 0)
    INTO v_cash_usd
    FROM pos_sale_payments p
    JOIN pos_sales s ON s.id = p.sale_id
   WHERE s.shift_id = p_shift_id
     AND s.status <> 'void'
     AND p.method = 'cash_usd';

  SELECT COALESCE(SUM(p.amount), 0)
    INTO v_cash_bs
    FROM pos_sale_payments p
    JOIN pos_sales s ON s.id = p.sale_id
   WHERE s.shift_id = p_shift_id
     AND s.status <> 'void'
     AND p.method = 'cash_bs';

  -- Gastos y transferencias que entran o salen del efectivo.
  -- Las ventas ya se contaron arriba, por eso se excluye category 'sale'.
  FOR v_tx IN
    SELECT t.kind, t.amount, a.kind AS account_kind
      FROM pos_transactions t
      JOIN pos_accounts a ON a.id = t.pos_account_id
     WHERE t.account_id = v_shift.account_id
       AND t.created_at >= v_shift.opened_at
       AND t.created_at <= COALESCE(v_shift.closed_at, NOW())
       AND a.kind IN ('cash_usd', 'cash_bs')
       AND COALESCE(t.category, '') <> 'sale'
  LOOP
    IF v_tx.account_kind = 'cash_usd' THEN
      v_cash_usd := v_cash_usd
        + CASE WHEN v_tx.kind = 'in' THEN v_tx.amount ELSE -v_tx.amount END;
    ELSE
      v_cash_bs := v_cash_bs
        + CASE WHEN v_tx.kind = 'in' THEN v_tx.amount ELSE -v_tx.amount END;
    END IF;
  END LOOP;

  v_cash_usd := ROUND(v_shift.opening_usd + v_cash_usd, 2);
  v_cash_bs := ROUND(v_shift.opening_bs + v_cash_bs, 2);

  SELECT COALESCE(jsonb_agg(row_data ORDER BY total DESC), '[]'::jsonb)
    INTO v_by_method
    FROM (
      SELECT
        jsonb_build_object(
          'method', p.method,
          'amount', ROUND(SUM(p.amount), 2),
          'amount_usd', ROUND(SUM(p.amount_usd + p.igtf_usd), 2)
        ) AS row_data,
        SUM(p.amount_usd + p.igtf_usd) AS total
        FROM pos_sale_payments p
        JOIN pos_sales s ON s.id = p.sale_id
       WHERE s.shift_id = p_shift_id
         AND s.status <> 'void'
       GROUP BY p.method
    ) grouped;

  RETURN jsonb_build_object(
    'shift_id', p_shift_id,
    'number', v_shift.number,
    'status', v_shift.status,
    'opened_at', v_shift.opened_at,
    'rate_open', v_shift.rate_open,
    'opening_usd', ROUND(v_shift.opening_usd, 2),
    'opening_bs', ROUND(v_shift.opening_bs, 2),
    'sales_usd', ROUND(v_sales_usd, 2),
    'sales_count', v_sales_count,
    'expected_usd', v_cash_usd,
    'expected_bs', v_cash_bs,
    'by_method', v_by_method
  );
END;
$$;

-- ------------------------------------------------------------
-- 4. Abrir turno
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_open_shift(
  p_opening_usd NUMERIC DEFAULT 0,
  p_opening_bs NUMERIC DEFAULT 0,
  p_rate NUMERIC DEFAULT 0,
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
  v_number INTEGER;
  v_shift UUID;
  v_rate NUMERIC := COALESCE(p_rate, 0);
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
     WHERE account_id = v_account AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'Ya hay un turno abierto';
  END IF;

  SELECT COALESCE(MAX(number), 0) + 1 INTO v_number
    FROM pos_shifts WHERE account_id = v_account;

  INSERT INTO pos_shifts (
    account_id, number, opened_by, opening_usd, opening_bs, rate_open, notes_open
  ) VALUES (
    v_account, v_number, v_user,
    COALESCE(p_opening_usd, 0), COALESCE(p_opening_bs, 0), v_rate, p_note
  ) RETURNING id INTO v_shift;

  RETURN jsonb_build_object(
    'shift_id', v_shift,
    'number', v_number,
    'rate', v_rate
  );
END;
$$;

-- ------------------------------------------------------------
-- 5. Cerrar turno con arqueo
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_close_shift(
  p_shift_id UUID,
  p_counted_usd NUMERIC DEFAULT 0,
  p_counted_bs NUMERIC DEFAULT 0,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_shift RECORD;
  v_summary JSONB;
  v_expected_usd NUMERIC;
  v_expected_bs NUMERIC;
  v_diff_usd NUMERIC;
  v_diff_bs NUMERIC;
  v_rate NUMERIC;
  v_total_diff_usd NUMERIC;
  v_total_diff_bs NUMERIC;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_shift FROM pos_shifts WHERE id = p_shift_id FOR UPDATE;
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Turno no encontrado';
  END IF;
  IF NOT is_account_member(v_shift.account_id, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'El turno ya está cerrado';
  END IF;

  v_summary := pos_shift_summary(p_shift_id);
  v_expected_usd := COALESCE((v_summary->>'expected_usd')::numeric, 0);
  v_expected_bs := COALESCE((v_summary->>'expected_bs')::numeric, 0);

  v_diff_usd := ROUND(COALESCE(p_counted_usd, 0) - v_expected_usd, 2);
  v_diff_bs := ROUND(COALESCE(p_counted_bs, 0) - v_expected_bs, 2);
  v_rate := COALESCE(v_shift.rate_open, 0);

  v_total_diff_usd := ROUND(
    v_diff_usd + CASE WHEN v_rate > 0 THEN v_diff_bs / v_rate ELSE 0 END,
    2
  );
  v_total_diff_bs := ROUND(
    v_diff_bs + CASE WHEN v_rate > 0 THEN v_diff_usd * v_rate ELSE 0 END,
    2
  );

  UPDATE pos_shifts
     SET status = 'closed',
         closed_by = v_user,
         closed_at = NOW(),
         expected_usd = v_expected_usd,
         expected_bs = v_expected_bs,
         counted_usd = ROUND(COALESCE(p_counted_usd, 0), 2),
         counted_bs = ROUND(COALESCE(p_counted_bs, 0), 2),
         difference_usd = v_total_diff_usd,
         difference_bs = v_total_diff_bs,
         sales_usd = COALESCE((v_summary->>'sales_usd')::numeric, 0),
         sales_count = COALESCE((v_summary->>'sales_count')::int, 0),
         by_method = COALESCE(v_summary->'by_method', '[]'::jsonb),
         notes_close = p_note
   WHERE id = p_shift_id;

  RETURN jsonb_build_object(
    'shift_id', p_shift_id,
    'number', v_shift.number,
    'expected_usd', v_expected_usd,
    'expected_bs', v_expected_bs,
    'counted_usd', ROUND(COALESCE(p_counted_usd, 0), 2),
    'counted_bs', ROUND(COALESCE(p_counted_bs, 0), 2),
    'difference_usd', v_total_diff_usd,
    'difference_bs', v_total_diff_bs
  );
END;
$$;

-- ------------------------------------------------------------
-- 6. Permisos
-- ------------------------------------------------------------
GRANT SELECT ON TABLE public.pos_shifts TO authenticated;
GRANT EXECUTE ON FUNCTION pos_shift_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_open_shift(NUMERIC, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_close_shift(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
