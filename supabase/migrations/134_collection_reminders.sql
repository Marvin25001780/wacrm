-- ============================================================
-- 134_collection_reminders.sql — recordatorios preventivos por cuota
--
-- Objetivo: avisar por WhatsApp y/o correo antes de que la cuota
-- venza, el día del vencimiento y a los N días de mora, sin que un
-- agente gaste minutos de llamada.
--
-- Modelo (inspirado en la escalera de seguimiento de Odoo
-- `account_followup`, LGPL-3, y en los estados de dunning de ERPNext,
-- GPL-3 — se adopta la idea, no el código):
--
--   * Una fila de reglas por negocio (`collection_reminder_settings`).
--     Tres peldaños fijos: antes, el día y después del vencimiento.
--     Los días y la hora son configurables por negocio.
--   * Una bitácora por cuota + peldaño + canal (`collection_reminder_log`)
--     con índice único: un recordatorio no se envía dos veces.
--   * `collection_reminder_claim` reserva el envío de forma atómica
--     (dos cron solapados no duplican). Si el envío queda colgado más
--     de 15 minutos, se puede reintentar.
--   * `collection_reminder_candidates` devuelve, para una fecha local,
--     exactamente las cuotas que toca recordar hoy, con saldo real,
--     contacto, negocio y si ya se avisó por cada canal.
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- 1. Reglas por negocio
-- ============================================================
CREATE TABLE IF NOT EXISTS public.collection_reminder_settings (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Nombre de una plantilla APPROVED de `message_templates`.
  whatsapp_template TEXT,
  email_subject TEXT NOT NULL DEFAULT 'Recordatorio de pago · {{negocio}}',
  email_body TEXT NOT NULL DEFAULT E'Hola {{deudor}}:\n\nTe recordamos que tu cuota {{cuota}} de {{negocio}} por {{monto}} vence el {{vencimiento}}.\n{{estado}}\n\nSi ya realizaste el pago, puedes ignorar este mensaje.\n\nGracias,\n{{negocio}}',
  days_before INTEGER NOT NULL DEFAULT 3
    CHECK (days_before >= 0 AND days_before <= 30),
  days_after INTEGER NOT NULL DEFAULT 5
    CHECK (days_after >= 1 AND days_after <= 60),
  -- Hora local del negocio a partir de la cual el cron puede enviar.
  send_hour INTEGER NOT NULL DEFAULT 9
    CHECK (send_hour >= 0 AND send_hour <= 23),
  max_per_run INTEGER NOT NULL DEFAULT 200
    CHECK (max_per_run >= 1 AND max_per_run <= 2000),
  last_run_at TIMESTAMPTZ,
  last_run_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.collection_reminder_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_reminder_settings_select ON public.collection_reminder_settings;
DROP POLICY IF EXISTS collection_reminder_settings_insert ON public.collection_reminder_settings;
DROP POLICY IF EXISTS collection_reminder_settings_update ON public.collection_reminder_settings;
DROP POLICY IF EXISTS collection_reminder_settings_delete ON public.collection_reminder_settings;

CREATE POLICY collection_reminder_settings_select ON public.collection_reminder_settings
  FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY collection_reminder_settings_insert ON public.collection_reminder_settings
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY collection_reminder_settings_update ON public.collection_reminder_settings
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY collection_reminder_settings_delete ON public.collection_reminder_settings
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON public.collection_reminder_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.collection_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. Bitácora de envíos
--
-- El índice único es la garantía de idempotencia: una cuota recibe
-- como máximo un recordatorio por peldaño y canal. Los fallos se
-- reintentan actualizando la misma fila (attempts + 1).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.collection_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  installment_id UUID NOT NULL REFERENCES public.collection_installments(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES public.collection_debtors(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('before_due', 'on_due', 'after_due')),
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  status TEXT NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  amount NUMERIC(14, 2),
  due_date DATE,
  external_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_reminder_log_unique
  ON public.collection_reminder_log(installment_id, kind, channel);
CREATE INDEX IF NOT EXISTS idx_collection_reminder_log_account_date
  ON public.collection_reminder_log(account_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_reminder_log_status
  ON public.collection_reminder_log(account_id, status);

ALTER TABLE public.collection_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_reminder_log_select ON public.collection_reminder_log;
DROP POLICY IF EXISTS collection_reminder_log_insert ON public.collection_reminder_log;
DROP POLICY IF EXISTS collection_reminder_log_update ON public.collection_reminder_log;
DROP POLICY IF EXISTS collection_reminder_log_delete ON public.collection_reminder_log;

CREATE POLICY collection_reminder_log_select ON public.collection_reminder_log
  FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY collection_reminder_log_insert ON public.collection_reminder_log
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY collection_reminder_log_update ON public.collection_reminder_log
  FOR UPDATE USING (public.is_account_member(account_id, 'agent'));
CREATE POLICY collection_reminder_log_delete ON public.collection_reminder_log
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

-- ============================================================
-- 3. Candidatos de hoy
--
-- "Hoy" es la fecha local del negocio (`collection_settings.timezone`).
-- El cron también puede pasar una fecha explícita (p_date) para
-- pruebas y para reintentos del mismo día.
--
-- Se excluyen:
--   * cuotas pagadas/canceladas o sin saldo,
--   * créditos que no están activos,
--   * deudores pagados, jurídicos o ilocalizables.
-- No se inventan contactos: si no hay teléfono ni correo, la fila
-- sale igual y el envío la descarta con su motivo.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_reminder_candidates(
  p_account_id UUID,
  p_date DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (
  installment_id UUID,
  credit_id UUID,
  debtor_id UUID,
  debtor_name TEXT,
  phone TEXT,
  email TEXT,
  installment_number INTEGER,
  due_date DATE,
  days_delta INTEGER,
  kind TEXT,
  balance NUMERIC,
  currency TEXT,
  business_name TEXT,
  whatsapp_sent BOOLEAN,
  email_sent BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.collection_reminder_settings;
  v_timezone TEXT;
  v_today DATE;
  v_limit INTEGER;
BEGIN
  IF NOT (
    public.is_account_member(p_account_id, 'agent')
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'No perteneces a este negocio.'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.* INTO v_settings
    FROM public.collection_reminder_settings s
   WHERE s.account_id = p_account_id;

  IF v_settings.account_id IS NULL OR NOT v_settings.enabled THEN
    RETURN;
  END IF;

  SELECT COALESCE(cs.timezone, 'America/Caracas') INTO v_timezone
    FROM public.collection_settings cs
   WHERE cs.account_id = p_account_id;
  v_timezone := COALESCE(v_timezone, 'America/Caracas');

  v_today := COALESCE(p_date, (NOW() AT TIME ZONE v_timezone)::DATE);
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);

  RETURN QUERY
  WITH base AS (
    SELECT
      i.id AS installment_id,
      i.credit_id,
      d.id AS debtor_id,
      COALESCE(NULLIF(btrim(d.name), ''), 'Deudor') AS debtor_name,
      NULLIF(
        btrim(
          COALESCE(NULLIF(btrim(d.phone_primary), ''), d.phone_secondary)
        ),
        ''
      ) AS phone,
      NULLIF(btrim(d.email), '') AS email,
      i.number AS installment_number,
      i.due_date,
      (i.due_date - v_today) AS days_delta,
      CASE
        WHEN i.due_date = v_today + v_settings.days_before THEN 'before_due'
        WHEN i.due_date = v_today THEN 'on_due'
        WHEN i.due_date = v_today - v_settings.days_after THEN 'after_due'
      END AS kind,
      GREATEST(i.total - i.paid_amount, 0) AS balance,
      c.currency,
      a.name AS business_name
    FROM public.collection_installments i
    JOIN public.collection_credits c
      ON c.id = i.credit_id
     AND c.status = 'active'
    JOIN public.collection_debtors d
      ON d.id = i.debtor_id
    JOIN public.accounts a
      ON a.id = i.account_id
   WHERE i.account_id = p_account_id
     AND i.status IN ('pending', 'partial')
     AND i.total > i.paid_amount
     AND d.status NOT IN ('pagado', 'ilocalizable', 'juridico')
     AND (v_settings.whatsapp_enabled OR v_settings.email_enabled)
     AND (
       i.due_date = v_today + v_settings.days_before
       OR i.due_date = v_today
       OR i.due_date = v_today - v_settings.days_after
     )
  )
  SELECT
    b.installment_id,
    b.credit_id,
    b.debtor_id,
    b.debtor_name,
    b.phone,
    b.email,
    b.installment_number,
    b.due_date,
    b.days_delta,
    b.kind,
    b.balance,
    b.currency,
    b.business_name,
    EXISTS (
      SELECT 1 FROM public.collection_reminder_log l
       WHERE l.installment_id = b.installment_id
         AND l.kind = b.kind
         AND l.channel = 'whatsapp'
         AND l.status = 'sent'
    ) AS whatsapp_sent,
    EXISTS (
      SELECT 1 FROM public.collection_reminder_log l
       WHERE l.installment_id = b.installment_id
         AND l.kind = b.kind
         AND l.channel = 'email'
         AND l.status = 'sent'
    ) AS email_sent
  FROM base b
  WHERE b.kind IS NOT NULL
  ORDER BY b.due_date ASC, b.balance DESC
  LIMIT v_limit;
END;
$$;

-- ============================================================
-- 4. Reserva atómica del envío
--
-- Devuelve TRUE solo si este proceso ganó el derecho a enviar.
--   * Primera vez: inserta en 'sending'.
--   * Ya enviado: FALSE (idempotencia).
--   * Falló o quedó colgado > 15 min: reintenta (attempts + 1).
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_reminder_claim(
  p_account_id UUID,
  p_installment_id UUID,
  p_kind TEXT,
  p_channel TEXT,
  p_amount NUMERIC DEFAULT NULL,
  p_due_date DATE DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT (
    public.is_account_member(p_account_id, 'agent')
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'No perteneces a este negocio.'
      USING ERRCODE = '42501';
  END IF;

  IF p_kind NOT IN ('before_due', 'on_due', 'after_due') THEN
    RAISE EXCEPTION 'Peldaño inválido: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_channel NOT IN ('whatsapp', 'email') THEN
    RAISE EXCEPTION 'Canal inválido: %', p_channel USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.collection_reminder_log (
    account_id, installment_id, debtor_id, kind, channel,
    status, attempts, amount, due_date
  )
  SELECT
    p_account_id, i.id, i.debtor_id, p_kind, p_channel,
    'sending', 1, p_amount, p_due_date
  FROM public.collection_installments i
  WHERE i.id = p_installment_id
    AND i.account_id = p_account_id
  ON CONFLICT (installment_id, kind, channel) DO UPDATE
    SET status = 'sending',
        attempts = public.collection_reminder_log.attempts + 1,
        error = NULL,
        amount = COALESCE(EXCLUDED.amount, public.collection_reminder_log.amount),
        due_date = COALESCE(EXCLUDED.due_date, public.collection_reminder_log.due_date),
        updated_at = NOW()
    WHERE public.collection_reminder_log.status <> 'sent'
      AND (
        public.collection_reminder_log.status <> 'sending'
        OR public.collection_reminder_log.updated_at < NOW() - INTERVAL '15 minutes'
      )
  RETURNING id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$$;

-- ============================================================
-- 5. Cierre del envío
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_reminder_finish(
  p_account_id UUID,
  p_installment_id UUID,
  p_kind TEXT,
  p_channel TEXT,
  p_status TEXT,
  p_external_id TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.is_account_member(p_account_id, 'agent')
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'No perteneces a este negocio.'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('sent', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.collection_reminder_log
     SET status = p_status,
         external_id = p_external_id,
         error = LEFT(p_error, 500),
         sent_at = CASE WHEN p_status = 'sent' THEN NOW() ELSE sent_at END,
         updated_at = NOW()
   WHERE account_id = p_account_id
     AND installment_id = p_installment_id
     AND kind = p_kind
     AND channel = p_channel;
END;
$$;

-- ============================================================
-- 6. Permisos
-- ============================================================
GRANT EXECUTE ON FUNCTION public.collection_reminder_candidates(UUID, DATE, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_reminder_claim(UUID, UUID, TEXT, TEXT, NUMERIC, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_reminder_finish(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
