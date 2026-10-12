-- ============================================================
-- 049_inbox_multichannel.sql — Bandeja multicanal (inbox)
--
-- Mejoras de la Bandeja de entrada:
--   1. `contacts.document` — Cédula/Documento del cliente, para el
--      match automático por teléfono, cédula o correo.
--   2. `leads.document` — mismo campo en los prospectos.
--   3. `leads.contact_id` — vínculo 1:1 del lead con su contacto
--      ("un lead por persona"): al recibir un mensaje nuevo se crea o
--      asocia el lead del contacto, y los leads duplicados (mismo
--      teléfono/cédula/correo) se fusionan en uno solo.
--   4. Bucket público `contact-avatars` para guardar las fotos de
--      perfil de los contactos (WhatsApp / Instagram / Facebook) y
--      mostrarlas con <img> plano en la Bandeja.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- 1) Cédula / Documento en contactos y leads --------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS document TEXT;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS document TEXT;

-- 2) Vínculo lead ↔ contacto (un lead por persona) --------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_leads_contact') THEN
    CREATE INDEX idx_leads_contact ON leads(account_id, contact_id);
  END IF;
  -- Un contacto cuelga de un único lead dentro de su cuenta. Los
  -- contact_id NULL (leads manuales / convertidos sin contacto
  -- vinculado) no colisionan entre sí (los NULL no entran en un
  -- índice único). El helper de ingesta hace upsert con este conflicto.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_leads_one_per_contact') THEN
    CREATE UNIQUE INDEX idx_leads_one_per_contact ON leads(account_id, contact_id);
  END IF;
END $$;

-- 3) Bucket de avatares de contactos ----------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contact-avatars',
  'contact-avatars',
  TRUE,
  2097152, -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lectura pública (el <img> plano de la Bandeja no usa URLs firmadas).
DROP POLICY IF EXISTS "Contact avatars are publicly readable" ON storage.objects;
CREATE POLICY "Contact avatars are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'contact-avatars');

-- Escrituras (agentes de la cuenta) bajo la carpeta account-<uuid>.
-- Sigue la misma convención de rutas que los buckets 020/023.
DROP POLICY IF EXISTS "Members upload contact avatars" ON storage.objects;
CREATE POLICY "Members upload contact avatars"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'contact-avatars'
    AND (storage.foldername(name))[1] LIKE 'account-%'
  );

DROP POLICY IF EXISTS "Members update contact avatars" ON storage.objects;
CREATE POLICY "Members update contact avatars"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'contact-avatars'
    AND (storage.foldername(name))[1] LIKE 'account-%'
  );

DROP POLICY IF EXISTS "Members delete contact avatars" ON storage.objects;
CREATE POLICY "Members delete contact avatars"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'contact-avatars'
    AND (storage.foldername(name))[1] LIKE 'account-%'
  );