-- ============================================================
-- 127_collection_whatsapp.sql - WhatsApp en la consola de cobranza
--
-- La consola (125) resuelve la llamada y la supervision (126)
-- reparte la cartera. Falta el canal que en Venezuela cierra las
-- promesas: WhatsApp.
--
-- Esta migracion NO envia mensajes ni duplica la logica de Meta.
-- Solo resuelve, del lado del servidor y con la tenencia validada,
-- las preguntas que la consola necesita responder sin exponer datos
-- de otras cuentas:
--
--   1. A que contacto y a que hilo de WhatsApp corresponde este
--      deudor (lo vincula por telefono si aun no lo esta).
--   2. La cuenta tiene una linea de WhatsApp utilizable.
--   3. Que se dijeron por ultima vez (hilo reciente, para no
--      repetir el mismo mensaje).
--
-- El envio sigue pasando por /api/whatsapp/send y por
-- sendMessageToConversation: un solo camino hacia Meta, con su
-- validacion, su rate limit y su registro en `messages`.
-- ============================================================

-- ============================================================
-- 1. Normalizador de telefono
--
-- Misma regla que normalizePhone() del frontend y que la columna
-- generada contacts.phone_normalized (022): solo digitos. Se usa
-- para comparar el telefono del deudor contra contactos existentes
-- sin depender de guiones, espacios ni del prefijo +.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_phone_digits(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
$$;

-- ============================================================
-- 2. Contexto de WhatsApp de un deudor
--
-- Devuelve, en una sola fila:
--   - el contacto vinculado (o NULL si todavia no existe),
--   - el hilo de WhatsApp mas reciente de ese contacto,
--   - el telefono en formato local y en E.164 (+58 para VE),
--   - si la cuenta tiene linea configurada / conectada,
--   - el ultimo mensaje y los no leidos del hilo.
--
-- Si el deudor no tiene contact_id pero su telefono coincide con
-- un contacto del negocio, lo vincula en el acto. La comparacion
-- es primero exacta sobre phone_normalized y, si no hay match,
-- por los ultimos 10 digitos (el mismo criterio con el que se
-- busca en el historial), para tolerar el 0 de marcacion nacional
-- (0414... vs 58414...).
--
-- No crea contactos ni conversaciones: de eso se encarga el envio
-- (resolveConversationByPhone) cuando el agente manda el primer
-- mensaje. Asi una consulta de la ficha nunca deja filas vacias.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_whatsapp_target(p_debtor_id UUID)
RETURNS TABLE (
  debtor_id UUID,
  account_id UUID,
  contact_id UUID,
  conversation_id UUID,
  display_name TEXT,
  phone TEXT,
  phone_e164 TEXT,
  country TEXT,
  whatsapp_configured BOOLEAN,
  whatsapp_connected BOOLEAN,
  last_message_at TIMESTAMPTZ,
  last_message_text TEXT,
  last_message_sender TEXT,
  unread_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debtor public.collection_debtors;
  v_contact UUID;
  v_contact_name TEXT;
  v_conv public.conversations;
  v_phone TEXT;
  v_digits TEXT;
  v_e164 TEXT;
  v_last_sender TEXT;
BEGIN
  SELECT d.* INTO v_debtor
    FROM public.collection_debtors d
   WHERE d.id = p_debtor_id;

  IF v_debtor.id IS NULL THEN
    RAISE EXCEPTION 'El deudor no existe.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT is_account_member(v_debtor.account_id, 'agent') THEN
    RAISE EXCEPTION 'No perteneces a este negocio.' USING ERRCODE = '42501';
  END IF;

  v_phone := COALESCE(
    NULLIF(btrim(v_debtor.phone_primary), ''),
    NULLIF(btrim(v_debtor.phone_secondary), '')
  );
  v_digits := public.collection_phone_digits(v_phone);

  -- Telefono primario con basura ("N/A") pero secundario usable.
  IF v_digits = '' THEN
    v_digits := public.collection_phone_digits(v_debtor.phone_secondary);
  END IF;

  -- Contacto ya vinculado, solo si sigue siendo de este negocio.
  IF v_debtor.contact_id IS NOT NULL THEN
    SELECT c.id, c.name
      INTO v_contact, v_contact_name
      FROM public.contacts c
     WHERE c.id = v_debtor.contact_id
       AND c.account_id = v_debtor.account_id;
  END IF;

  -- Vinculo por telefono cuando aun no hay contacto.
  IF v_contact IS NULL AND v_digits <> '' THEN
    SELECT c.id, c.name
      INTO v_contact, v_contact_name
      FROM public.contacts c
     WHERE c.account_id = v_debtor.account_id
       AND c.phone_normalized <> ''
       AND (
         c.phone_normalized = v_digits
         OR (
           length(v_digits) >= 10
           AND length(c.phone_normalized) >= 10
           AND right(c.phone_normalized, 10) = right(v_digits, 10)
         )
       )
     ORDER BY (c.phone_normalized = v_digits) DESC, c.created_at ASC
     LIMIT 1;
  END IF;

  IF v_contact IS NOT NULL
     AND v_debtor.contact_id IS DISTINCT FROM v_contact THEN
    UPDATE public.collection_debtors d
       SET contact_id = v_contact
     WHERE d.id = v_debtor.id;
  END IF;

  -- Hilo de WhatsApp mas reciente del contacto, de cualquier linea.
  IF v_contact IS NOT NULL THEN
    SELECT c.* INTO v_conv
      FROM public.conversations c
     WHERE c.account_id = v_debtor.account_id
       AND c.contact_id = v_contact
       AND c.channel = 'whatsapp'
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC,
              c.created_at DESC
     LIMIT 1;
  END IF;

  IF v_conv.id IS NOT NULL THEN
    SELECT m.sender_type INTO v_last_sender
      FROM public.messages m
     WHERE m.conversation_id = v_conv.id
     ORDER BY m.created_at DESC
     LIMIT 1;
  END IF;

  -- E.164. Venezuela: 04141234567 / 4141234567 / 584141234567
  -- producen +584141234567. Otros paises: se respeta el numero
  -- tal cual, sin inventar prefijos.
  IF v_digits = '' THEN
    v_e164 := NULL;
  ELSIF upper(COALESCE(NULLIF(btrim(v_debtor.country), ''), 'VE')) = 'VE' THEN
    IF length(v_digits) = 11 AND left(v_digits, 1) = '0' THEN
      v_e164 := '+58' || substr(v_digits, 2);
    ELSIF length(v_digits) = 10 THEN
      v_e164 := '+58' || v_digits;
    ELSE
      v_e164 := '+' || v_digits;
    END IF;
  ELSE
    v_e164 := '+' || v_digits;
  END IF;

  RETURN QUERY
  SELECT
    v_debtor.id,
    v_debtor.account_id,
    v_contact,
    v_conv.id,
    COALESCE(
      NULLIF(btrim(v_debtor.name), ''),
      NULLIF(btrim(v_contact_name), ''),
      'Deudor'
    ),
    v_phone,
    v_e164,
    COALESCE(NULLIF(btrim(v_debtor.country), ''), 'VE'),
    EXISTS (
      SELECT 1 FROM public.whatsapp_config w
       WHERE w.account_id = v_debtor.account_id
    ),
    EXISTS (
      SELECT 1 FROM public.whatsapp_config w
       WHERE w.account_id = v_debtor.account_id
         AND w.status = 'connected'
    ),
    v_conv.last_message_at,
    v_conv.last_message_text,
    v_last_sender,
    COALESCE(v_conv.unread_count, 0);
END;
$$;

-- ============================================================
-- 3. Hilo reciente del deudor
--
-- Devuelve los ultimos mensajes del hilo en orden cronologico
-- (el mas viejo primero, para pintarlo tal cual). El tope se
-- recorta a 1..50 en el servidor: la consola no necesita mas
-- para decidir que responder.
-- ============================================================
CREATE OR REPLACE FUNCTION public.collection_whatsapp_thread(
  p_debtor_id UUID,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  message_id UUID,
  sender_type TEXT,
  content_type TEXT,
  content_text TEXT,
  media_url TEXT,
  template_name TEXT,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv UUID;
  v_limit INTEGER;
BEGIN
  SELECT t.conversation_id INTO v_conv
    FROM public.collection_whatsapp_target(p_debtor_id) t;

  IF v_conv IS NULL THEN
    RETURN;
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);

  RETURN QUERY
  SELECT m.id,
         m.sender_type,
         m.content_type,
         m.content_text,
         m.media_url,
         m.template_name,
         m.status,
         m.created_at
    FROM (
      SELECT mm.*
        FROM public.messages mm
       WHERE mm.conversation_id = v_conv
       ORDER BY mm.created_at DESC
       LIMIT v_limit
    ) m
   ORDER BY m.created_at ASC;
END;
$$;

-- ============================================================
-- 4. Indice para leer el hilo sin ordenar toda la conversacion
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_messages_conversation_recent
  ON public.messages (conversation_id, created_at DESC);

-- ============================================================
-- 5. Permisos
--
-- SECURITY DEFINER valida la pertenencia, pero igual se cierra
-- la ejecucion a PUBLIC: solo entra quien tiene sesion.
-- ============================================================
REVOKE ALL ON FUNCTION public.collection_phone_digits(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_whatsapp_target(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_whatsapp_thread(UUID, INT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.collection_phone_digits(TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_whatsapp_target(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_whatsapp_thread(UUID, INT)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   DROP INDEX IF EXISTS public.idx_messages_conversation_recent;
--   DROP FUNCTION IF EXISTS public.collection_whatsapp_thread(UUID, INT);
--   DROP FUNCTION IF EXISTS public.collection_whatsapp_target(UUID);
--   DROP FUNCTION IF EXISTS public.collection_phone_digits(TEXT);
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
