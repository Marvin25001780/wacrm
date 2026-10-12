-- ============================================================
-- 048_tiktok_channel.sql — conexión de TikTok (Login Kit / OAuth).
--
-- TikTok tampoco usa QR: se conecta con el flujo OAuth de Login Kit
-- (client_key + redirect_uri + scopes) y el token se canjea en el
-- servidor con el client_secret. Esta migración solo habilita el canal
-- en `channel_configs` (la tabla ya es genérica).
--
-- La mensajería (leer/enviar DM) depende de la Business Messaging API
-- de TikTok, que exige una cuenta de empresa y acceso aprobado; el
-- esquema queda listo para cuando se habilite.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- channel_configs: habilitar 'tiktok' además de los canales actuales.
ALTER TABLE channel_configs DROP CONSTRAINT IF EXISTS channel_configs_channel_check;
ALTER TABLE channel_configs
  ADD CONSTRAINT channel_configs_channel_check
  CHECK (channel IN ('evolution', 'chatwoot', 'instagram', 'facebook', 'tiktok'));
