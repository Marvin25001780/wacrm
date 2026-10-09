-- ============================================================
-- 035_attachments.sql — Adjuntos (Attachments)
--
-- Core CRM: archivos ligados a un Contacto, Lead, Empresa,
-- Oferta y/o Actividad. El binario vive en el bucket privado
-- `attachments` de Supabase Storage (path account-scoped) y la
-- tabla guarda la metadata + los vínculos.
--
-- Bucket PRIVADO: la descarga se hace con URL firmada
-- (createSignedUrl) generada bajo demanda; las lecturas están
-- limitadas a miembros de la cuenta (RLS sobre storage.objects).
--
-- Añade:
--   1. Bucket `attachments` (privado) + políticas de Storage.
--   2. Tabla `attachments` (cuenta-scoped, RLS por membresía).
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- 1. Bucket `attachments` (privado)
--    Mismo límite/formato que chat-media; path account-scoped.
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  FALSE, -- privado: acceso vía URL firmada
  26214400, -- 25 MB
  ARRAY[
    -- Imágenes
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    -- Documentos
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv',
    -- Comprimidos
    'application/zip', 'application/x-rar-compressed',
    -- Genérico (algunos navegadores no envían type)
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 2. Storage RLS — lectura y escritura solo miembros de la cuenta
--    (mismo predicado que 020/023, pero SELECT restringido en
--    lugar de público porque el bucket es privado).
-- ============================================================
DROP POLICY IF EXISTS "Attachments are readable by members" ON storage.objects;
CREATE POLICY "Attachments are readable by members"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can upload attachments" ON storage.objects;
CREATE POLICY "Members can upload attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update attachments" ON storage.objects;
CREATE POLICY "Members can update attachments"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete attachments" ON storage.objects;
CREATE POLICY "Members can delete attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ============================================================
-- 3. Tabla `attachments`
-- ============================================================
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Tenancy key — toda fila pertenece a una cuenta.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Quién subió el archivo (auth.users.id = profiles.user_id).
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Nombre original mostrado al usuario.
  file_name TEXT NOT NULL,
  -- Ruta del objeto en el bucket `attachments` (account-scoped).
  file_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  -- Vínculos opcionales. La metadata se borra con la entidad,
  -- pero el binario se GC-ea aparte al eliminar el adjunto.
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_account   ON attachments(account_id);
CREATE INDEX IF NOT EXISTS idx_attachments_created   ON attachments(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_contact   ON attachments(contact_id);
CREATE INDEX IF NOT EXISTS idx_attachments_lead      ON attachments(lead_id);
CREATE INDEX IF NOT EXISTS idx_attachments_org       ON attachments(organization_id);
CREATE INDEX IF NOT EXISTS idx_attachments_deal      ON attachments(deal_id);
CREATE INDEX IF NOT EXISTS idx_attachments_activity  ON attachments(activity_id);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- Idempotencia: CREATE POLICY no tiene IF NOT EXISTS → drop primero.
DROP POLICY IF EXISTS attachments_select ON attachments;
DROP POLICY IF EXISTS attachments_insert ON attachments;
DROP POLICY IF EXISTS attachments_update ON attachments;
DROP POLICY IF EXISTS attachments_delete ON attachments;

-- Viewer+ lee; agente+ crea/edita/borra (dato operativo).
CREATE POLICY attachments_select ON attachments FOR SELECT USING (is_account_member(account_id));
CREATE POLICY attachments_insert ON attachments FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY attachments_update ON attachments FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY attachments_delete ON attachments FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON attachments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON attachments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
