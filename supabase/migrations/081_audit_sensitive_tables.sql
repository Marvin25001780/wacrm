-- ============================================================
-- 081_audit_sensitive_tables.sql — ampliar la auditoría
--
-- `audit_row()` ya existía y cubre configuraciones de canales,
-- agentes de IA, bots, segmentos y todo el módulo de cobranza.
-- Faltaban las tablas donde se cambian permisos, credenciales de
-- WhatsApp, invitaciones y envíos masivos.
--
-- audit_row() descarta columnas sensibles (tokens, secretos) y resuelve
-- account_id; las tablas sin cuenta se ignoran.
--
-- Idempotente.
-- ============================================================

-- Roles y permisos de los usuarios del negocio.
DROP TRIGGER IF EXISTS audit_profiles ON profiles;
CREATE TRIGGER audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- Credenciales y configuración de WhatsApp.
DROP TRIGGER IF EXISTS audit_whatsapp_config ON whatsapp_config;
CREATE TRIGGER audit_whatsapp_config
  AFTER INSERT OR UPDATE OR DELETE ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- Políticas de cobranza (tramos, topes, comisiones).
DROP TRIGGER IF EXISTS audit_collection_settings ON collection_settings;
CREATE TRIGGER audit_collection_settings
  AFTER INSERT OR UPDATE OR DELETE ON collection_settings
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- Invitaciones: quién invita a quién y con qué rol.
DROP TRIGGER IF EXISTS audit_account_invitations ON account_invitations;
CREATE TRIGGER audit_account_invitations
  AFTER INSERT OR UPDATE OR DELETE ON account_invitations
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- Envíos masivos.
DROP TRIGGER IF EXISTS audit_broadcasts ON broadcasts;
CREATE TRIGGER audit_broadcasts
  AFTER INSERT OR UPDATE OR DELETE ON broadcasts
  FOR EACH ROW EXECUTE FUNCTION audit_row();
