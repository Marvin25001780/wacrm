-- ============================================================
-- 135_collection_payment_links.sql — enlaces de pago y comprobantes
--
-- Cierra el ciclo del recordatorio: el deudor recibe el aviso, abre
-- un enlace con su saldo real, ve cómo pagar y reporta la
-- transferencia con su referencia. El equipo la revisa y, al
-- aprobarla, el pago entra a la cartera con los triggers existentes
-- (`collection_validate_payment` + `collection_recompute_after_payment`).
--
-- Piezas:
--   1. collection_payment_settings  — datos bancarios por negocio.
--   2. collection_payment_links     — token público por deudor.
--   3. collection_receipts          — comprobantes reportados.
--   4. RPCs: crear/reutilizar enlace, consulta pública, reportar
--      comprobante y revisión (aprobar/rechazar) con reparto por
--      cuotas más antiguas.
--
-- Seguridad:
--   * El token es aleatorio (UUID v4 sin guiones) y no revela ids.
--   * La consulta pública devuelve solo nombre, negocio, saldo,
--     cuotas abiertas e instrucciones de pago. Ni documento ni
--     teléfono del deudor.
--   * Un comprobante duplicado (misma referencia + monto) se rechaza
--     con un índice único parcial.
--   * Aprobar exige admin/owner; el pago se aplica a las cuotas del
--     MISMO deudor y nunca por encima de su saldo.
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- 1. Datos para pagar (por negocio)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.collection_payment_settings (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  bank_name TEXT,
  account_number TEXT,
  account_type TEXT,
  account_holder TEXT,
  holder_document TEXT,
  mobile_payment_phone TEXT,
  mobile_payment_bank TEXT,
  support_phone TEXT,
  instructions TEXT,
  link_expiry_days INTEGER NOT NULL DEFAULT 7
    CHECK (link_expiry_days >= 1 AND link_expiry_days <= 90),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.collection_payment_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_payment_settings_select ON public.collection_payment_settings;
DROP POLICY IF EXISTS collection_payment_settings_insert ON public.collection_payment_settings;
DROP POLICY IF EXISTS collection_payment_settings_update ON public.collection_payment_settings;
DROP POLICY IF EXISTS collection_payment_settings_delete ON public.collection_payment_settings;

CREATE POLICY collection_payment_settings_select ON public.collection_payment_settings
  FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY collection_payment_settings_insert ON public.collection_payment_settings
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY collection_payment_settings_update ON public.collection_payment_settings
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY collection_payment_settings_delete ON public.collection_payment_settings
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON public.collection_payment_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.collection_payment_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. Enlaces públicos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.collection_payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES public.collection_debtors(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE
    DEFAULT replace(gen_random_uuid()::text, '-', ''),
  -- NULL = se muestra el saldo abierto completo al momento de abrir.
  amount NUMERIC(14, 2) CHECK (amount IS NULL OR amount > 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_payment_links_debtor
  ON public.collection_payment_links(debtor_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_payment_links_account
  ON public.collection_payment_links(account_id, created_at DESC);

ALTER TABLE public.collection_payment_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_payment_links_select ON public.collection_payment_links;
DROP POLICY IF EXISTS collection_payment_links_insert ON public.collection_payment_links;
DROP POLICY IF EXISTS collection_payment_links_update ON public.collection_payment_links;
DROP POLICY IF EXISTS collection_payment_links_delete ON public.collection_payment_links;

CREATE POLICY collection_payment_links_select ON public.collection_payment_links
  FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY collection_payment_links_insert ON public.collection_payment_links
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY collection_payment_links_update ON public.collection_payment_links
  FOR UPDATE USING (public.is_account_member(account_id, 'agent'));
CREATE POLICY collection_payment_links_delete ON public.collection_payment_links
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

-- ============================================================
-- 3. Comprobantes reportados
--
-- El índice único parcial evita cargar dos veces la misma
-- transferencia (misma referencia + monto). Los rechazados no
-- bloquean una nueva carga corregida.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.collection_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES public.collection_debtors(id) ON DELETE CASCADE,
  payment_link_id UUID REFERENCES public.collection_payment_links(id) ON DELETE SET NULL,
  installment_id UUID REFERENCES public.collection_installments(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'link'
    CHECK (channel IN ('link', 'whatsapp', 'email', 'manual')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  reference TEXT,
  bank TEXT,
  file_url TEXT,
  mime_type TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_receipts_reference_unique
  ON public.collection_receipts(account_id, lower(reference), amount)
  WHERE reference IS NOT NULL AND status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS idx_collection_receipts_status
  ON public.collection_receipts(account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_receipts_debtor
  ON public.collection_receipts(debtor_id, created_at DESC);

ALTER TABLE public.collection_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_receipts_select ON public.collection_receipts;
DROP POLICY IF EXISTS collection_receipts_insert ON public.collection_receipts;
DROP POLICY IF EXISTS collection_receipts_update ON public.collection_receipts;
DROP POLICY IF EXISTS collection_receipts_delete ON public.collection_receipts;

CREATE POLICY collection_receipts_select ON public.collection_receipts
  FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY collection_receipts_insert ON public.collection_receipts
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY collection_receipts_update ON public.collection_receipts
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY collection_receipts_delete ON public.collection_receipts
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON public.collection_receipts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.collection_receipts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 4. Crear o reutilizar el enlace del deudor
--
-- Un deudor tiene como máximo un enlace activo vigente. Si ya existe,
-- se devuelve el mismo (created = false) para que el recordatorio y
-- el botón manual apunten siempre al mismo sitio.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_payment_link_for_debtor(
  p_debtor_id UUID,
  p_amount NUMERIC DEFAULT NULL,
  p_days INTEGER DEFAULT NULL
)
RETURNS TABLE (
  link_id UUID,
  token TEXT,
  amount NUMERIC,
  expires_at TIMESTAMPTZ,
  created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debtor public.collection_debtors;
  v_link public.collection_payment_links;
  v_days INTEGER;
  v_total NUMERIC;
BEGIN
  SELECT d.* INTO v_debtor
    FROM public.collection_debtors d
   WHERE d.id = p_debtor_id;

  IF v_debtor.id IS NULL THEN
    RAISE EXCEPTION 'El deudor no existe.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.is_account_member(v_debtor.account_id, 'agent')
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  SELECT l.* INTO v_link
    FROM public.collection_payment_links l
   WHERE l.debtor_id = p_debtor_id
     AND l.status = 'active'
     AND l.expires_at > NOW()
   ORDER BY l.created_at DESC
   LIMIT 1;

  IF v_link.id IS NOT NULL THEN
    RETURN QUERY
      SELECT v_link.id, v_link.token, v_link.amount, v_link.expires_at, FALSE;
    RETURN;
  END IF;

  UPDATE public.collection_payment_links
     SET status = 'expired'
   WHERE debtor_id = p_debtor_id
     AND status = 'active'
     AND expires_at <= NOW();

  SELECT COALESCE(ps.link_expiry_days, 7) INTO v_days
    FROM public.collection_payment_settings ps
   WHERE ps.account_id = v_debtor.account_id;
  v_days := LEAST(GREATEST(COALESCE(p_days, v_days, 7), 1), 90);

  SELECT COALESCE(SUM(i.total - i.paid_amount), 0) INTO v_total
    FROM public.collection_installments i
   WHERE i.debtor_id = p_debtor_id
     AND i.status IN ('pending', 'partial')
     AND i.total > i.paid_amount;

  INSERT INTO public.collection_payment_links (
    account_id, debtor_id, amount, expires_at, created_by
  )
  VALUES (
    v_debtor.account_id,
    p_debtor_id,
    COALESCE(p_amount, NULLIF(v_total, 0)),
    NOW() + make_interval(days => v_days),
    auth.uid()
  )
  RETURNING * INTO v_link;

  RETURN QUERY
    SELECT v_link.id, v_link.token, v_link.amount, v_link.expires_at, TRUE;
END;
$$;

-- ============================================================
-- 5. Consulta pública por token
--
-- Devuelve JSON para que la página pública no tenga que leer tablas
-- protegidas. No incluye documento, teléfono ni correo del deudor.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_payment_link_public(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.collection_payment_links;
  v_payload JSONB;
BEGIN
  SELECT l.* INTO v_link
    FROM public.collection_payment_links l
   WHERE l.token = btrim(p_token);

  IF v_link.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_found');
  END IF;

  IF v_link.status = 'active' AND v_link.expires_at <= NOW() THEN
    UPDATE public.collection_payment_links
       SET status = 'expired'
     WHERE id = v_link.id;
    v_link.status := 'expired';
  END IF;

  IF v_link.status <> 'active' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', v_link.status);
  END IF;

  SELECT jsonb_build_object(
    'ok', TRUE,
    'status', 'active',
    'expires_at', v_link.expires_at,
    'business_name', a.name,
    'debtor_name', d.name,
    'currency', 'USD',
    'link_amount', v_link.amount,
    'total_balance', COALESCE(balance.total, 0),
    'instructions', jsonb_build_object(
      'enabled', COALESCE(ps.enabled, FALSE),
      'bank_name', ps.bank_name,
      'account_number', ps.account_number,
      'account_type', ps.account_type,
      'account_holder', ps.account_holder,
      'holder_document', ps.holder_document,
      'mobile_payment_phone', ps.mobile_payment_phone,
      'mobile_payment_bank', ps.mobile_payment_bank,
      'support_phone', ps.support_phone,
      'notes', ps.instructions
    ),
    'installments', COALESCE(balance.items, '[]'::jsonb)
  )
  INTO v_payload
  FROM public.accounts a
  JOIN public.collection_debtors d
    ON d.id = v_link.debtor_id
  LEFT JOIN public.collection_payment_settings ps
    ON ps.account_id = v_link.account_id
  LEFT JOIN LATERAL (
    SELECT
      SUM(i.total - i.paid_amount) AS total,
      jsonb_agg(
        jsonb_build_object(
          'number', i.number,
          'due_date', i.due_date,
          'balance', i.total - i.paid_amount,
          'status', i.status
        )
        ORDER BY i.due_date, i.number
      ) AS items
    FROM public.collection_installments i
    WHERE i.debtor_id = v_link.debtor_id
      AND i.status IN ('pending', 'partial')
      AND i.total > i.paid_amount
  ) balance ON TRUE
  WHERE a.id = v_link.account_id;

  RETURN COALESCE(v_payload, jsonb_build_object('ok', FALSE, 'reason', 'not_found'));
END;
$$;

-- ============================================================
-- 6. Reportar comprobante (público, con token)
--
-- No aprueba nada: deja el comprobante en `pending` para revisión.
-- Valida monto, referencia y fecha; el duplicado lo corta el índice.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_receipt_submit(
  p_token TEXT,
  p_amount NUMERIC,
  p_paid_at DATE DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_bank TEXT DEFAULT NULL,
  p_file_url TEXT DEFAULT NULL,
  p_mime_type TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.collection_payment_links;
  v_total NUMERIC;
  v_paid_at DATE;
  v_receipt public.collection_receipts;
BEGIN
  SELECT l.* INTO v_link
    FROM public.collection_payment_links l
   WHERE l.token = btrim(p_token);

  IF v_link.id IS NULL OR v_link.status <> 'active' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'link_unavailable');
  END IF;
  IF v_link.expires_at <= NOW() THEN
    UPDATE public.collection_payment_links
       SET status = 'expired'
     WHERE id = v_link.id;
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'expired');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor que cero.' USING ERRCODE = '22023';
  END IF;
  IF btrim(COALESCE(p_reference, '')) = '' THEN
    RAISE EXCEPTION 'La referencia de la transferencia es obligatoria.'
      USING ERRCODE = '22023';
  END IF;

  v_paid_at := COALESCE(p_paid_at, CURRENT_DATE);
  IF v_paid_at < CURRENT_DATE - 90 OR v_paid_at > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'La fecha del pago está fuera del rango permitido (últimos 90 días).'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(i.total - i.paid_amount), 0) INTO v_total
    FROM public.collection_installments i
   WHERE i.debtor_id = v_link.debtor_id
     AND i.status IN ('pending', 'partial')
     AND i.total > i.paid_amount;

  IF p_amount > v_total + 0.01 THEN
    RAISE EXCEPTION 'El monto supera el saldo pendiente (%).', v_total
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.collection_receipts (
      account_id, debtor_id, payment_link_id, channel,
      amount, paid_at, reference, bank, file_url, mime_type, notes, status
    )
    VALUES (
      v_link.account_id,
      v_link.debtor_id,
      v_link.id,
      'link',
      p_amount,
      v_paid_at,
      LEFT(btrim(p_reference), 80),
      NULLIF(btrim(COALESCE(p_bank, '')), ''),
      NULLIF(btrim(COALESCE(p_file_url, '')), ''),
      NULLIF(btrim(COALESCE(p_mime_type, '')), ''),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      'pending'
    )
    RETURNING * INTO v_receipt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe un comprobante con esa referencia y monto.'
      USING ERRCODE = '23505';
  END;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'receipt_id', v_receipt.id,
    'status', v_receipt.status
  );
END;
$$;

-- ============================================================
-- 7. Revisión del comprobante
--
-- Aprobar aplica el pago a las cuotas abiertas del deudor, de la más
-- antigua a la más nueva. Si el admin indica una cuota, todo el monto
-- va a esa cuota (y debe alcanzar). Rechazar solo cierra el
-- comprobante; no toca la cartera.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_receipt_review(
  p_receipt_id UUID,
  p_decision TEXT,
  p_installment_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.collection_receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.collection_receipts;
  v_remaining NUMERIC;
  v_alloc NUMERIC;
  v_balance NUMERIC;
  v_first UUID;
  v_row RECORD;
BEGIN
  SELECT r.* INTO v_receipt
    FROM public.collection_receipts r
   WHERE r.id = p_receipt_id
   FOR UPDATE;

  IF v_receipt.id IS NULL THEN
    RAISE EXCEPTION 'El comprobante no existe.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.is_account_member(v_receipt.account_id, 'admin')
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Solo un administrador puede revisar comprobantes.'
      USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Decisión inválida: %', p_decision USING ERRCODE = '22023';
  END IF;

  -- Idempotencia: repetir la misma decisión devuelve el estado actual.
  IF v_receipt.status = 'approved' AND p_decision = 'approve' THEN
    RETURN v_receipt;
  END IF;
  IF v_receipt.status = 'rejected' AND p_decision = 'reject' THEN
    RETURN v_receipt;
  END IF;
  IF v_receipt.status <> 'pending' THEN
    RAISE EXCEPTION 'El comprobante ya fue revisado.' USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.collection_receipts
       SET status = 'rejected',
           review_notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
           reviewed_by = auth.uid(),
           reviewed_at = NOW(),
           updated_at = NOW()
     WHERE id = p_receipt_id
     RETURNING * INTO v_receipt;
    RETURN v_receipt;
  END IF;

  v_remaining := v_receipt.amount;

  IF p_installment_id IS NOT NULL THEN
    SELECT i.id, (i.total - i.paid_amount) AS balance
      INTO v_row
      FROM public.collection_installments i
     WHERE i.id = p_installment_id
       AND i.account_id = v_receipt.account_id
       AND i.debtor_id = v_receipt.debtor_id
       AND i.status IN ('pending', 'partial')
     FOR UPDATE;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'La cuota no pertenece al deudor o ya está pagada.'
        USING ERRCODE = '22023';
    END IF;
    IF v_receipt.amount > v_row.balance + 0.005 THEN
      RAISE EXCEPTION 'El comprobante (%) excede el saldo de la cuota (%).',
        v_receipt.amount, v_row.balance USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.collection_payments (
      account_id, installment_id, credit_id, debtor_id, amount, paid_at,
      method, reference, source, notes, created_by
    )
    SELECT
      i.account_id, i.id, i.credit_id, i.debtor_id, v_receipt.amount,
      v_receipt.paid_at, 'transfer', v_receipt.reference, 'link',
      'Comprobante ' || v_receipt.id, auth.uid()
    FROM public.collection_installments i
    WHERE i.id = p_installment_id;

    v_first := p_installment_id;
    v_remaining := 0;
  ELSE
    FOR v_row IN
      SELECT i.id, (i.total - i.paid_amount) AS balance
        FROM public.collection_installments i
       WHERE i.account_id = v_receipt.account_id
         AND i.debtor_id = v_receipt.debtor_id
         AND i.status IN ('pending', 'partial')
         AND i.total > i.paid_amount
       ORDER BY i.due_date ASC, i.number ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0.005;

      v_balance := v_row.balance;
      v_alloc := LEAST(v_remaining, v_balance);
      CONTINUE WHEN v_alloc <= 0.005;

      INSERT INTO public.collection_payments (
        account_id, installment_id, credit_id, debtor_id, amount, paid_at,
        method, reference, source, notes, created_by
      )
      SELECT
        i.account_id, i.id, i.credit_id, i.debtor_id, v_alloc,
        v_receipt.paid_at, 'transfer', v_receipt.reference, 'link',
        'Comprobante ' || v_receipt.id, auth.uid()
      FROM public.collection_installments i
      WHERE i.id = v_row.id;

      v_first := COALESCE(v_first, v_row.id);
      v_remaining := v_remaining - v_alloc;
    END LOOP;
  END IF;

  IF v_remaining > 0.005 THEN
    RAISE EXCEPTION 'El comprobante excede el saldo pendiente del deudor (% sin aplicar).',
      v_remaining USING ERRCODE = '22023';
  END IF;

  UPDATE public.collection_receipts
     SET status = 'approved',
         installment_id = v_first,
         review_notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
         reviewed_by = auth.uid(),
         reviewed_at = NOW(),
         updated_at = NOW()
   WHERE id = p_receipt_id
   RETURNING * INTO v_receipt;

  -- Si el deudor quedó sin saldo, sus enlaces activos dejan de servir.
  IF NOT EXISTS (
    SELECT 1 FROM public.collection_installments i
     WHERE i.debtor_id = v_receipt.debtor_id
       AND i.status IN ('pending', 'partial')
       AND i.total > i.paid_amount
  ) THEN
    UPDATE public.collection_payment_links
       SET status = 'used', used_at = NOW()
     WHERE debtor_id = v_receipt.debtor_id
       AND status = 'active';
  END IF;

  RETURN v_receipt;
END;
$$;

-- ============================================================
-- 8. Permisos
-- ============================================================
GRANT EXECUTE ON FUNCTION public.collection_payment_link_for_debtor(UUID, NUMERIC, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_payment_link_public(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_receipt_submit(TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_receipt_review(UUID, TEXT, UUID, TEXT) TO authenticated, service_role;
