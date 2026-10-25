-- ============================================================
-- 076_collection_reporting.sql - Prioridad, PTP y vistas
--
-- Crea:
--   1. collection_tramo()                  - clasificación por mora
--   2. collection_recompute_priorities()   - motor de reglas
--   3. collection_mark_broken_promises()   - cron diario
--   4. collection_resolve_promise()        - cierre manual de PTP
--   5. Vistas de cartera, aging, PTP, recuperación, comisiones
--
-- Idempotente - seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- 1. Tramo por días de mora
-- ============================================================
CREATE OR REPLACE FUNCTION collection_tramo(p_days INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_days IS NULL OR p_days <= 15 THEN '1_15'
    WHEN p_days <= 30 THEN '16_30'
    WHEN p_days <= 60 THEN '31_60'
    WHEN p_days <= 90 THEN '61_90'
    ELSE '90_plus'
  END;
$$;

-- ============================================================
-- 2. Priorización por reglas transparentes
--
-- score = 35*urgencia + 25*valor + 20*propensión
--       + 15*contactabilidad + 5*ventana (fija en 0.5 en v1)
--
-- No es una probabilidad. Se muestra como índice 0-100 con una
-- razón legible. El ML se evalúa cuando haya historial suficiente.
-- ============================================================
CREATE OR REPLACE FUNCTION collection_recompute_priorities(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max NUMERIC;
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT COALESCE(MAX(overdue), 0) INTO v_max
    FROM (
      SELECT d.id,
             COALESCE(SUM(i.total - i.paid_amount) FILTER (
               WHERE i.status IN ('pending', 'partial') AND i.due_date < CURRENT_DATE
             ), 0) AS overdue
        FROM collection_debtors d
        LEFT JOIN collection_installments i ON i.debtor_id = d.id
       WHERE d.account_id = p_account_id
       GROUP BY d.id
    ) s;

  WITH base AS (
    SELECT d.id,
           COALESCE(SUM(i.total - i.paid_amount) FILTER (
             WHERE i.status IN ('pending', 'partial')
           ), 0) AS balance,
           COALESCE(SUM(i.total - i.paid_amount) FILTER (
             WHERE i.status IN ('pending', 'partial') AND i.due_date < CURRENT_DATE
           ), 0) AS overdue,
           COALESCE(MAX(CURRENT_DATE - i.due_date) FILTER (
             WHERE i.status IN ('pending', 'partial') AND i.due_date < CURRENT_DATE
           ), 0) AS days
      FROM collection_debtors d
      LEFT JOIN collection_installments i ON i.debtor_id = d.id
     WHERE d.account_id = p_account_id
       AND d.status <> 'pagado'
     GROUP BY d.id
  ),
  actions AS (
    SELECT a.debtor_id,
           COUNT(*) FILTER (WHERE a.level1_code IN ('contacted', 'third_party')) AS contacted,
           COUNT(*) AS total
      FROM collection_actions a
     WHERE a.account_id = p_account_id
       AND a.created_at >= NOW() - INTERVAL '30 days'
     GROUP BY a.debtor_id
  ),
  promises AS (
    SELECT p.debtor_id,
           COUNT(*) FILTER (WHERE p.status = 'kept') AS kept,
           COUNT(*) FILTER (WHERE p.status IN ('kept', 'broken', 'partial')) AS resolved
      FROM collection_promises p
     WHERE p.account_id = p_account_id
     GROUP BY p.debtor_id
  ),
  scored AS (
    SELECT b.id,
           ROUND((
             35 * LEAST(GREATEST(b.days, 0)::NUMERIC / 120.0, 1)
             + 25 * CASE WHEN v_max > 0 THEN b.overdue / v_max ELSE 0 END
             + 20 * CASE
                 WHEN COALESCE(pr.resolved, 0) > 0
                   THEN pr.kept::NUMERIC / pr.resolved
                 ELSE 0.5
               END
             + 15 * CASE
                 WHEN COALESCE(ac.total, 0) > 0
                   THEN ac.contacted::NUMERIC / ac.total
                 ELSE 0.5
               END
             + 5 * 0.5
           )::NUMERIC, 2) AS score,
           b.days,
           b.overdue,
           b.balance,
           COALESCE(ac.total, 0) AS attempts,
           COALESCE(ac.contacted, 0) AS contacted,
           COALESCE(pr.kept, 0) AS kept,
           COALESCE(pr.resolved, 0) AS resolved
      FROM base b
      LEFT JOIN actions ac ON ac.debtor_id = b.id
      LEFT JOIN promises pr ON pr.debtor_id = b.id
  )
  UPDATE collection_debtors d
     SET priority_score = s.score,
         priority_reason = concat_ws(
           ' · ',
           CASE WHEN s.days > 0 THEN format('Mora %sd', s.days) ELSE 'Sin mora' END,
           format('Saldo vencido USD %s', to_char(s.overdue, 'FM999999990.00')),
           format('%s/%s gestiones contestadas', s.contacted, s.attempts),
           format('%s PTP cumplidas', s.kept)
         ),
         priority_updated_at = NOW()
    FROM scored s
   WHERE d.id = s.id;

  UPDATE collection_debtors
     SET priority_score = 0,
         priority_reason = 'Cartera cerrada',
         priority_updated_at = NOW()
   WHERE account_id = p_account_id
     AND status = 'pagado';
END;
$$;

-- ============================================================
-- 3. PTP vencidas (cron diario)
-- ============================================================
CREATE OR REPLACE FUNCTION collection_mark_broken_promises(p_account_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  UPDATE collection_promises
     SET status = 'broken',
         resolved_at = NOW(),
         updated_at = NOW()
   WHERE account_id = p_account_id
     AND status IN ('pending', 'partial')
     AND paid_amount < amount
     AND due_date < CURRENT_DATE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================
-- 4. Cierre manual de una PTP
-- ============================================================
CREATE OR REPLACE FUNCTION collection_resolve_promise(
  p_promise_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_current TEXT;
BEGIN
  IF p_status NOT IN ('kept', 'broken', 'cancelled') THEN
    RAISE EXCEPTION 'Estado de PTP inválido: %', p_status;
  END IF;

  SELECT account_id, status INTO v_account, v_current
    FROM collection_promises WHERE id = p_promise_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'PTP no encontrada';
  END IF;
  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF v_current = 'cancelled' THEN
    RAISE EXCEPTION 'La PTP ya está cancelada';
  END IF;

  UPDATE collection_promises
     SET status = p_status,
         resolved_at = NOW(),
         updated_at = NOW()
   WHERE id = p_promise_id;

  RETURN jsonb_build_object('id', p_promise_id, 'status', p_status);
END;
$$;

-- ============================================================
-- 5. Vistas
-- ============================================================

CREATE OR REPLACE VIEW v_collection_debtor_summary
WITH (security_invoker = true) AS
SELECT
  d.id,
  d.account_id,
  d.portfolio_id,
  d.name,
  d.document_number,
  d.phone_primary,
  d.email,
  d.segment,
  d.status,
  d.assigned_to,
  d.priority_score,
  d.priority_reason,
  d.created_at,
  d.updated_at,
  COUNT(i.id) FILTER (WHERE i.status IN ('pending', 'partial')) AS open_installments,
  COALESCE(SUM(i.total - i.paid_amount) FILTER (
    WHERE i.status IN ('pending', 'partial')
  ), 0) AS balance,
  COALESCE(SUM(i.total - i.paid_amount) FILTER (
    WHERE i.status IN ('pending', 'partial') AND i.due_date < CURRENT_DATE
  ), 0) AS overdue_balance,
  COALESCE(MAX(CURRENT_DATE - i.due_date) FILTER (
    WHERE i.status IN ('pending', 'partial') AND i.due_date < CURRENT_DATE
  ), 0) AS days_overdue_max,
  MAX(a.created_at) AS last_action_at
FROM collection_debtors d
LEFT JOIN collection_installments i ON i.debtor_id = d.id
LEFT JOIN collection_actions a ON a.debtor_id = d.id
GROUP BY d.id;

CREATE OR REPLACE VIEW v_collection_aging
WITH (security_invoker = true) AS
SELECT
  x.account_id,
  COALESCE(SUM(x.balance) FILTER (WHERE x.days IS NULL OR x.days <= 0), 0) AS current,
  COALESCE(SUM(x.balance) FILTER (WHERE x.days BETWEEN 1 AND 30), 0) AS d1_30,
  COALESCE(SUM(x.balance) FILTER (WHERE x.days BETWEEN 31 AND 60), 0) AS d31_60,
  COALESCE(SUM(x.balance) FILTER (WHERE x.days BETWEEN 61 AND 90), 0) AS d61_90,
  COALESCE(SUM(x.balance) FILTER (WHERE x.days > 90), 0) AS d90_plus
FROM (
  SELECT account_id,
         total - paid_amount AS balance,
         CURRENT_DATE - due_date AS days
    FROM collection_installments
   WHERE status IN ('pending', 'partial')
) x
GROUP BY x.account_id;

CREATE OR REPLACE VIEW v_collection_promise_stats
WITH (security_invoker = true) AS
SELECT
  account_id,
  status,
  COUNT(*) AS count,
  COALESCE(SUM(amount), 0) AS amount,
  COALESCE(SUM(paid_amount), 0) AS paid_amount
FROM collection_promises
GROUP BY account_id, status;

CREATE OR REPLACE VIEW v_collection_daily_recovery
WITH (security_invoker = true) AS
SELECT
  account_id,
  paid_at,
  COUNT(*) AS payments,
  COALESCE(SUM(amount), 0) AS recovered
FROM collection_payments
GROUP BY account_id, paid_at;

CREATE OR REPLACE VIEW v_collection_agent_performance
WITH (security_invoker = true) AS
SELECT
  a.account_id,
  a.user_id,
  COUNT(*) AS actions,
  COUNT(*) FILTER (WHERE a.level1_code IN ('contacted', 'third_party')) AS contacted,
  COUNT(*) FILTER (WHERE a.level2_code = 'ptp') AS promises_created
FROM collection_actions a
GROUP BY a.account_id, a.user_id;

CREATE OR REPLACE VIEW v_collection_commissions
WITH (security_invoker = true) AS
SELECT
  p.account_id,
  COALESCE(la.user_id, d.assigned_to) AS user_id,
  date_trunc('month', p.paid_at)::DATE AS month,
  SUM(p.amount) AS recovered,
  SUM(p.amount * COALESCE(cr.percentage, 0) / 100) AS commission
FROM collection_payments p
JOIN collection_debtors d ON d.id = p.debtor_id
LEFT JOIN LATERAL (
  SELECT a.user_id
    FROM collection_actions a
   WHERE a.debtor_id = p.debtor_id
   ORDER BY a.created_at DESC
   LIMIT 1
) la ON TRUE
LEFT JOIN LATERAL (
  SELECT collection_tramo(GREATEST(COALESCE(MAX(CURRENT_DATE - i.due_date), 0), 0)) AS tramo
    FROM collection_installments i
   WHERE i.credit_id = p.credit_id
     AND i.status IN ('pending', 'partial')
) t ON TRUE
LEFT JOIN collection_commission_rules cr
  ON cr.account_id = p.account_id
 AND cr.tramo = t.tramo
 AND cr.active
GROUP BY p.account_id, COALESCE(la.user_id, d.assigned_to), date_trunc('month', p.paid_at);

GRANT SELECT ON v_collection_debtor_summary TO authenticated;
GRANT SELECT ON v_collection_aging TO authenticated;
GRANT SELECT ON v_collection_promise_stats TO authenticated;
GRANT SELECT ON v_collection_daily_recovery TO authenticated;
GRANT SELECT ON v_collection_agent_performance TO authenticated;
GRANT SELECT ON v_collection_commissions TO authenticated;

GRANT SELECT ON v_collection_debtor_summary TO service_role;
GRANT SELECT ON v_collection_aging TO service_role;
GRANT SELECT ON v_collection_promise_stats TO service_role;
GRANT SELECT ON v_collection_daily_recovery TO service_role;
GRANT SELECT ON v_collection_agent_performance TO service_role;
GRANT SELECT ON v_collection_commissions TO service_role;

-- Sin esto PostgREST sigue sirviendo su caché anterior y las vistas
-- responden 404 ("Could not find the table ... in the schema cache")
-- aunque existan en Postgres.
NOTIFY pgrst, 'reload schema';
