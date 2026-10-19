-- ============================================================
-- 065 — `chat-media` pasa a ser un bucket PRIVADO
--
-- Problema (auditoría S2): el bucket se creó público en la migración
-- 023, así que cualquier persona con la URL podía descargar adjuntos de
-- conversaciones (fotos, audios, documentos de clientes) sin sesión.
--
-- Solución:
--   1. `public = false`.
--   2. SELECT solo para miembros de la cuenta dueña del objeto. La ruta
--      conserva la convención `account-<account_id>/<archivo>` de 023.
--   3. Los objetos que escribe el servidor (espejo de media entrante)
--      usan service_role, que no pasa por RLS.
--
-- La app no guarda URLs firmadas: sigue guardando la URL "lógica" del
-- objeto y la firma al usarla (hook del inbox) o justo antes de enviar a
-- Meta (send-message.ts). Por eso las filas históricas de
-- `messages.media_url` siguen funcionando sin backfill.
--
-- ORDEN DE DESPLIEGUE: primero el código (que ya firma), luego esta
-- migración. Al revés, los adjuntos existentes darían 400 hasta que la
-- app nueva esté en producción.
--
-- Nota: las imágenes de muestra de plantillas se mueven a `flow-media`
-- (público, son material de marketing, no conversaciones) porque Meta
-- las descarga durante la revisión.
-- ============================================================

-- 1. Bucket privado
UPDATE storage.buckets
SET public = FALSE
WHERE id = 'chat-media';

-- 2. Lectura solo para miembros de la cuenta
DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;

DROP POLICY IF EXISTS "Members can read chat media" ON storage.objects;
CREATE POLICY "Members can read chat media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) =
            (storage.foldername(name))[1]
    )
  );

-- ============================================================
-- Validación (solo lectura) después de aplicar:
--
--   SELECT id, public FROM storage.buckets WHERE id = 'chat-media';
--   -- public = false
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname ILIKE '%chat media%';
--
-- Rollback (vuelve al comportamiento anterior):
--   UPDATE storage.buckets SET public = TRUE WHERE id = 'chat-media';
--   DROP POLICY IF EXISTS "Members can read chat media" ON storage.objects;
--   CREATE POLICY "Chat media is publicly readable"
--     ON storage.objects FOR SELECT USING (bucket_id = 'chat-media');
-- ============================================================
