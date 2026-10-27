-- ============================================================
-- 096_pos_denominations.sql — Arqueo por denominaciones
--
-- * Guarda el desglose de billetes y monedas del cierre.
-- * pos_close_shift recibe el desglose además de los totales.
--
-- Idempotente.
-- ============================================================

ALTER TABLE pos_shifts
  ADD COLUMN IF NOT EXISTS counted_usd_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS counted_bs_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP FUNCTION IF EXISTS pos_close_shift(UUID, NUMERIC, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION pos_close_shift(
  p_shift_id UUID,
  p_counted_usd NUMERIC DEFAULT 0,
  p_counted_bs NUMERIC DEFAULT 0,
  p_note TEXT DEFAULT NULL,
  p_usd_breakdown JSONB DEFAULT '{}'::jsonb,
  p_bs_breakdown JSONB DEFAULT '{}'::jsonb
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
         counted_usd_breakdown = COALESCE(p_usd_breakdown, '{}'::jsonb),
         counted_bs_breakdown = COALESCE(p_bs_breakdown, '{}'::jsonb),
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

GRANT EXECUTE ON FUNCTION pos_close_shift(
  UUID, NUMERIC, NUMERIC, TEXT, JSONB, JSONB
) TO authenticated;

NOTIFY pgrst, 'reload schema';
