-- ============================================================
-- 038_chat.sql — Chat interno del equipo  ·  módulo 2.3
--
-- Mensajería interna entre los miembros de una cuenta (distinta del
-- Inbox de WhatsApp). Un "canal" agrupa a varios miembros; los
-- mensajes se entregan en vivo vía Supabase Realtime.
--
-- Crea:
--   1. `chat_channels`         — canales del equipo.
--   2. `chat_channel_members`  — miembros del canal (+ last_read_at).
--   3. `chat_messages`         — mensajes.
--
-- Idempotente — seguro de ejecutar varias veces.
-- ============================================================

-- ============================================================
-- 1. chat_channels
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Tenancy key — NOT NULL.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Reservado para mensajes directos 1:1 (no expuesto todavía).
  is_direct BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_channels_account ON chat_channels(account_id);

ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_channels_select ON chat_channels;
DROP POLICY IF EXISTS chat_channels_insert ON chat_channels;
DROP POLICY IF EXISTS chat_channels_update ON chat_channels;
DROP POLICY IF EXISTS chat_channels_delete ON chat_channels;

CREATE POLICY chat_channels_select ON chat_channels
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY chat_channels_insert ON chat_channels
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY chat_channels_update ON chat_channels
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY chat_channels_delete ON chat_channels
  FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON chat_channels;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON chat_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. chat_channel_members
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_channel_members (
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  -- Redundante con chat_channels.account_id, pero simplifica las RLS.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Marca de lectura para futuros contadores de no leídos.
  last_read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_members_channel ON chat_channel_members(channel_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_channel_members(account_id, user_id);

ALTER TABLE chat_channel_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_channel_members_select ON chat_channel_members;
DROP POLICY IF EXISTS chat_channel_members_insert ON chat_channel_members;
DROP POLICY IF EXISTS chat_channel_members_update ON chat_channel_members;
DROP POLICY IF EXISTS chat_channel_members_delete ON chat_channel_members;

CREATE POLICY chat_channel_members_select ON chat_channel_members
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY chat_channel_members_insert ON chat_channel_members
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
-- last_read_at: cada quien actualiza su propia fila; agent+ gestiona el resto.
CREATE POLICY chat_channel_members_update ON chat_channel_members
  FOR UPDATE USING (user_id = auth.uid() OR is_account_member(account_id, 'agent'));
CREATE POLICY chat_channel_members_delete ON chat_channel_members
  FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- 3. chat_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_account ON chat_messages(account_id);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_messages_select ON chat_messages;
DROP POLICY IF EXISTS chat_messages_insert ON chat_messages;
DROP POLICY IF EXISTS chat_messages_update ON chat_messages;
DROP POLICY IF EXISTS chat_messages_delete ON chat_messages;

CREATE POLICY chat_messages_select ON chat_messages
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY chat_messages_insert ON chat_messages
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent') AND sender_id = auth.uid());
-- Solo el autor puede editar/borrar su propio mensaje.
CREATE POLICY chat_messages_update ON chat_messages
  FOR UPDATE USING (sender_id = auth.uid());
CREATE POLICY chat_messages_delete ON chat_messages
  FOR DELETE USING (sender_id = auth.uid() OR is_account_member(account_id, 'admin'));

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
END $$;
