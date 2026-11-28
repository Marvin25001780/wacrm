-- ============================================================
-- 136_collection_receipt_capture.sql — captura automática de comprobantes
--
-- El deudor ya puede reportar un comprobante desde su enlace público
-- (135). Falta el camino que de verdad usa en Venezuela: manda la foto
-- del pago por WhatsApp. Este bloque lo captura sin depender de que un
-- humano abra la bandeja:
--
--   1. OCR de la imagen con el proveedor de IA del negocio
--      (OpenAI, Gemini, Anthropic o Groq con visión).
--   2. Acción `register_receipt` del agente de IA para cuando el deudor
--      escribe los datos del pago en texto.
--   3. `collection_receipt_capture`: crea el comprobante en `pending`,
--      idempotente por mensaje de WhatsApp.
--   4. `collection_receipt_update`: permite corregir monto, referencia,
--      banco y fecha antes de aprobar. El OCR se equivoca; el admin
--      manda.
--   5. `collection_debtor_for_phone`: resuelve el deudor por teléfono
--      con la misma tolerancia que la consola de cobranza (127).
--
-- Reglas de seguridad:
--   * Nada se aprueba automáticamente: todo entra en `pending` y lo
--     revisa un admin/owner.
--   * Solo se captura si el teléfono pertenece a un deudor de la cuenta.
--   * Un mensaje de WhatsApp genera como máximo un comprobante.
--   * El OCR nunca inventa datos: los campos ilegibles quedan NULL.
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- 1. Preferencias de captura (por negocio)
-- ============================================================
ALTER TABLE public.collection_payment_settings
  ADD COLUMN IF NOT EXISTS receipt_capture_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS receipt_ack_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS receipt_ack_text TEXT DEFAULT
    '¡Gracias! Recibimos tu comprobante y quedó en revisión. Te confirmamos por aquí cuando el pago esté aplicado.';

-- Palanca del agente para registrar comprobantes desde un texto.
ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS action_receipts BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- 2. Metadatos de captura en el comprobante
-- ============================================================
ALTER TABLE public.collection_receipts
  ADD COLUMN IF NOT EXISTS conversation_id UUID
    REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_message_id TEXT,
  ADD COLUMN IF NOT EXISTS capture_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (capture_source IN ('link', 'agent', 'ocr', 'manual')),
  ADD COLUMN IF NOT EXISTS ocr_confidence NUMERIC(4, 3)
    CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS ocr_raw JSONB,
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;

-- Filas históricas: los comprobantes con enlace son de origen `link`.
UPDATE public.collection_receipts
   SET capture_source = 'link'
 WHERE payment_link_id IS NOT NULL
   AND capture_source = 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_receipts_source_message
  ON public.collection_receipts(account_id, source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_collection_receipts_conversation
  ON public.collection_receipts(conversation_id, created_at DESC);

-- Un comprobante que nace desde el enlace se etiqueta solo. El default
-- de la columna sigue siendo `manual` para las filas creadas por otras
-- vías (importaciones, correcciones).
CREATE OR REPLACE FUNCTION public.collection_receipt_set_source()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.capture_source = 'manual' AND NEW.payment_link_id IS NOT NULL THEN
    NEW.capture_source := 'link';
  END IF;
  NEW.captured_at := COALESCE(NEW.captured_at, NEW.created_at, NOW());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_receipt_set_source ON public.collection_receipts;
CREATE TRIGGER collection_receipt_set_source
  BEFORE INSERT ON public.collection_receipts
  FOR EACH ROW EXECUTE FUNCTION public.collection_receipt_set_source();

-- ============================================================
-- 3. Resolver deudor por teléfono
--
-- Reutiliza `collection_phone_digits` (127) y compara primero exacto y
-- después por los últimos 10 dígitos. Devuelve el saldo abierto para
-- que quien captura decida si vale la pena crear el comprobante.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_debtor_for_phone(
  p_account_id UUID,
  p_phone TEXT
)
RETURNS TABLE (
  debtor_id UUID,
  debtor_name TEXT,
  phone TEXT,
  open_balance NUMERIC,
  match_kind TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits TEXT;
BEGIN
  IF NOT (
    public.is_account_member(p_account_id, 'agent')
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  v_digits := public.collection_phone_digits(p_phone);
  IF v_digits = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      d.id,
      d.name,
      COALESCE(
        NULLIF(btrim(d.phone_primary), ''),
        NULLIF(btrim(d.phone_secondary), '')
      ) AS phone,
      COALESCE((
        SELECT SUM(i.total - i.paid_amount)
          FROM public.collection_installments i
         WHERE i.debtor_id = d.id
           AND i.status IN ('pending', 'partial')
           AND i.total > i.paid_amount
      ), 0) AS open_balance,
      CASE
        WHEN public.collection_phone_digits(d.phone_primary) = v_digits
          OR public.collection_phone_digits(d.phone_secondary) = v_digits
        THEN 0
        ELSE 1
      END AS match_rank
    FROM public.collection_debtors d
    WHERE d.account_id = p_account_id
      AND (
        public.collection_phone_digits(d.phone_primary) = v_digits
        OR public.collection_phone_digits(d.phone_secondary) = v_digits
        OR (
          length(v_digits) >= 10
          AND length(public.collection_phone_digits(d.phone_primary)) >= 10
          AND right(public.collection_phone_digits(d.phone_primary), 10) = right(v_digits, 10)
        )
        OR (
          length(v_digits) >= 10
          AND length(public.collection_phone_digits(d.phone_secondary)) >= 10
          AND right(public.collection_phone_digits(d.phone_secondary), 10) = right(v_digits, 10)
        )
      )
  )
  SELECT
    c.id,
    c.name,
    c.phone,
    c.open_balance,
    CASE WHEN c.match_rank = 0 THEN 'exact' ELSE 'last10' END
  FROM candidates c
  ORDER BY
    c.match_rank ASC,
    (c.open_balance > 0) DESC,
    c.open_balance DESC,
    c.name ASC
  LIMIT 1;
END;
$$;

-- ============================================================
-- 4. Capturar un comprobante desde WhatsApp
--
-- No aprueba ni toca la cartera: inserta en `pending`. El admin lo
-- revisa y `collection_receipt_review` (135) aplica el pago.
--
-- `p_capture_source` distingue:
--   ocr    → imagen leída automáticamente,
--   agent  → el agente de IA extrajo los datos de un texto,
--   manual → carga asistida por un humano.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_receipt_capture(
  p_account_id UUID,
  p_debtor_id UUID,
  p_conversation_id UUID DEFAULT NULL,
  p_source_message_id TEXT DEFAULT NULL,
  p_capture_source TEXT DEFAULT 'manual',
  p_amount NUMERIC DEFAULT NULL,
  p_paid_at DATE DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_bank TEXT DEFAULT NULL,
  p_file_url TEXT DEFAULT NULL,
  p_mime_type TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_confidence NUMERIC DEFAULT NULL,
  p_ocr_raw JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source TEXT;
  v_existing public.collection_receipts;
  v_receipt public.collection_receipts;
  v_paid_at DATE;
  v_reference TEXT;
BEGIN
  IF NOT (
    public.is_account_member(p_account_id, 'agent')
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  v_source := COALESCE(NULLIF(btrim(p_capture_source), ''), 'manual');
  IF v_source NOT IN ('agent', 'ocr', 'manual') THEN
    RAISE EXCEPTION 'Origen de captura inválido: %', v_source
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.collection_debtors d
     WHERE d.id = p_debtor_id
       AND d.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'El deudor no pertenece a este negocio.' USING ERRCODE = 'P0002';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor que cero.' USING ERRCODE = '22023';
  END IF;

  v_paid_at := COALESCE(p_paid_at, CURRENT_DATE);
  IF v_paid_at < CURRENT_DATE - 90 OR v_paid_at > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'La fecha del pago está fuera del rango permitido (últimos 90 días).'
      USING ERRCODE = '22023';
  END IF;

  v_reference := NULLIF(btrim(COALESCE(p_reference, '')), '');
  IF v_reference IS NOT NULL AND length(v_reference) > 80 THEN
    RAISE EXCEPTION 'La referencia no puede pasar de 80 caracteres.'
      USING ERRCODE = '22023';
  END IF;

  -- Idempotencia por mensaje: el webhook puede reintentar la entrega.
  IF p_source_message_id IS NOT NULL THEN
    SELECT r.* INTO v_existing
      FROM public.collection_receipts r
     WHERE r.account_id = p_account_id
       AND r.source_message_id = btrim(p_source_message_id)
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', TRUE,
        'receipt_id', v_existing.id,
        'status', v_existing.status,
        'duplicate', TRUE
      );
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.collection_receipts (
      account_id, debtor_id, conversation_id, source_message_id,
      channel, capture_source, amount, paid_at, reference, bank,
      file_url, mime_type, notes, status, ocr_confidence, ocr_raw,
      captured_at
    )
    VALUES (
      p_account_id,
      p_debtor_id,
      p_conversation_id,
      NULLIF(btrim(COALESCE(p_source_message_id, '')), ''),
      CASE WHEN v_source = 'manual' THEN 'manual' ELSE 'whatsapp' END,
      v_source,
      p_amount,
      v_paid_at,
      v_reference,
      NULLIF(btrim(COALESCE(p_bank, '')), ''),
      NULLIF(btrim(COALESCE(p_file_url, '')), ''),
      NULLIF(btrim(COALESCE(p_mime_type, '')), ''),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      'pending',
      CASE
        WHEN p_confidence IS NULL THEN NULL
        ELSE LEAST(GREATEST(p_confidence, 0), 1)
      END,
      p_ocr_raw,
      NOW()
    )
    RETURNING * INTO v_receipt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe un comprobante con esa referencia y monto.'
      USING ERRCODE = '23505';
  END;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'receipt_id', v_receipt.id,
    'status', v_receipt.status,
    'duplicate', FALSE
  );
END;
$$;

-- ============================================================
-- 5. Corregir un comprobante pendiente
--
-- El OCR puede leer mal un monto o una referencia. Solo se corrige
-- mientras está `pending`; un comprobante aprobado ya movió cartera y
-- un rechazado se vuelve a cargar.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_receipt_update(
  p_receipt_id UUID,
  p_amount NUMERIC DEFAULT NULL,
  p_paid_at DATE DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_bank TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.collection_receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.collection_receipts;
  v_amount NUMERIC;
  v_paid_at DATE;
  v_reference TEXT;
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
    RAISE EXCEPTION 'Solo un administrador puede corregir comprobantes.'
      USING ERRCODE = '42501';
  END IF;

  IF v_receipt.status <> 'pending' THEN
    RAISE EXCEPTION 'Solo se corrigen comprobantes pendientes.'
      USING ERRCODE = '22023';
  END IF;

  v_amount := COALESCE(p_amount, v_receipt.amount);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor que cero.' USING ERRCODE = '22023';
  END IF;

  v_paid_at := COALESCE(p_paid_at, v_receipt.paid_at);
  IF v_paid_at < CURRENT_DATE - 90 OR v_paid_at > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'La fecha del pago está fuera del rango permitido (últimos 90 días).'
      USING ERRCODE = '22023';
  END IF;

  v_reference := COALESCE(
    NULLIF(btrim(COALESCE(p_reference, '')), ''),
    v_receipt.reference
  );
  IF v_reference IS NOT NULL AND length(v_reference) > 80 THEN
    RAISE EXCEPTION 'La referencia no puede pasar de 80 caracteres.'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    UPDATE public.collection_receipts
       SET amount = v_amount,
           paid_at = v_paid_at,
           reference = v_reference,
           bank = COALESCE(NULLIF(btrim(COALESCE(p_bank, '')), ''), bank),
           notes = COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), notes),
           updated_at = NOW()
     WHERE id = p_receipt_id
     RETURNING * INTO v_receipt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe un comprobante con esa referencia y monto.'
      USING ERRCODE = '23505';
  END;

  RETURN v_receipt;
END;
$$;

-- ============================================================
-- 6. Permisos
-- ============================================================
REVOKE ALL ON FUNCTION public.collection_debtor_for_phone(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_receipt_capture(
  UUID, UUID, UUID, TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_receipt_update(
  UUID, NUMERIC, DATE, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.collection_debtor_for_phone(UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_receipt_capture(
  UUID, UUID, UUID, TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, JSONB
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_receipt_update(
  UUID, NUMERIC, DATE, TEXT, TEXT, TEXT
) TO authenticated, service_role;
