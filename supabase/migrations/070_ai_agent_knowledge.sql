-- ============================================================
-- 070_ai_agent_knowledge.sql — Agente de IA: conocimiento + acciones + avanzada
--
-- Complementa lo que el motor ya usa (058 + A5): ahora el agente
-- puede tener PROPIA base de conocimiento, EJECUTAR acciones sobre el
-- CRM y ajustes FINOS de respuesta.
--
-- 1. Conocimiento (A2)
--    - `ai_knowledge_sources`: fuentes de texto compartidas por
--      cuenta (llamamos "base compartida", como Callbell: todas las
--      fuentes viven juntas y cada agente activa las suyas).
--    - `ai_qa_pairs`: preguntas y respuestas curadas (cuando el
--      negocio ya sabe qué responder, no deja que el modelo improvise).
--    - `ai_agent_source_access`: qué fuentes puede leer cada agente
--      ("1 de N fuentes activada para este agente").
--    - Recuperación: la búsqueda es por palabras clave (puntuación en
--      JS sobre título+contenido, sin escaping). pgvector queda como
--      UPGRADE cuando el volumen lo pidan; así funciona con CUALQUIER
--      proveedor sin configuración extra.
--
-- 2. Acciones (A3) — palancas por agente; el protocolo JSON del
--    modelo las ejecuta el motor (tags/campos/cerrar/nota; asignar
--    se queda para cuando exista "equipos").
--
-- 3. Avanzada (A4) — mensaje de salida al alcanzar el objetivo,
--    calidad de respuesta (concisa/equilibrada/detallada), tope de
--    botones, recordatorios y retraso del seguimiento.
--
-- RLS al estilo 058 (misma tabla dueña): SELECT para todo miembro;
-- escritura admin+ (la configuración del agente no es cosa de
-- viewers). El MOTOR ejecuta las acciones con service-role (bypass
-- RLS intencional, como el resto del motor de WhatsApp).
--
-- Entorno: primero DEV. Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. CONOCIMIENTO
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  content            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'available'
                     CHECK (status IN ('available', 'error')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_account
  ON ai_knowledge_sources(account_id);

-- Q&A curadas (compartidas por cuenta; todo agente las puede usar).
CREATE TABLE IF NOT EXISTS ai_qa_pairs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  question           TEXT NOT NULL,
  answer             TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_qa_account
  ON ai_qa_pairs(account_id);

-- Qué fuentes puede leer cada agente (toggle "activa" de Callbell).
-- Sin filas = el agente no lee NINGUNA fuente (el admin decide).
CREATE TABLE IF NOT EXISTS ai_agent_source_access (
  agent_id  UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_source_agent
  ON ai_agent_source_access(agent_id);

-- ---- RLS de conocimiento --------------------------------------
ALTER TABLE ai_knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_qa_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_source_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_select ON ai_knowledge_sources;
CREATE POLICY knowledge_select ON ai_knowledge_sources FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS knowledge_insert ON ai_knowledge_sources;
CREATE POLICY knowledge_insert ON ai_knowledge_sources FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS knowledge_update ON ai_knowledge_sources;
CREATE POLICY knowledge_update ON ai_knowledge_sources FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS knowledge_delete ON ai_knowledge_sources;
CREATE POLICY knowledge_delete ON ai_knowledge_sources FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS qa_select ON ai_qa_pairs;
CREATE POLICY qa_select ON ai_qa_pairs FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS qa_insert ON ai_qa_pairs;
CREATE POLICY qa_insert ON ai_qa_pairs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS qa_update ON ai_qa_pairs;
CREATE POLICY qa_update ON ai_qa_pairs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS qa_delete ON ai_qa_pairs;
CREATE POLICY qa_delete ON ai_qa_pairs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS agent_source_select ON ai_agent_source_access;
CREATE POLICY agent_source_select ON ai_agent_source_access FOR SELECT
  USING (is_account_member(
    (SELECT account_id FROM ai_agents WHERE id = agent_id)
  ));
DROP POLICY IF EXISTS agent_source_write ON ai_agent_source_access;
CREATE POLICY agent_source_write ON ai_agent_source_access FOR ALL
  USING (is_account_member(
    (SELECT account_id FROM ai_agents WHERE id = agent_id), 'admin'
  ));

-- Grants estándar de Supabase para las tablas nuevas.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ai_knowledge_sources, ai_qa_pairs, ai_agent_source_access
  TO authenticated;
GRANT ALL
  ON ai_knowledge_sources, ai_qa_pairs, ai_agent_source_access
  TO service_role;

-- ============================================================
-- 2. ACCIONES por agente (A3)
-- ============================================================
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS action_tags    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS action_fields  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS action_assign  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS action_close   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS action_notes   BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 3. AVANZADA por agente (A4)
-- ============================================================
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS exit_message TEXT;

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS response_quality TEXT NOT NULL DEFAULT 'balanced'
  CHECK (response_quality IN ('concise', 'balanced', 'detailed'));

-- Tope de botones/opciones por respuesta (Callbell pregunta "hasta N").
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS max_reply_buttons SMALLINT NOT NULL DEFAULT 2
  CHECK (max_reply_buttons BETWEEN 0 AND 4);

-- Recordatorios permitidos y el retraso entre ellos.
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS max_reminders SMALLINT NOT NULL DEFAULT 2
  CHECK (max_reminders BETWEEN 0 AND 5);

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS follow_up_delay_minutes SMALLINT NOT NULL DEFAULT 30
  CHECK (follow_up_delay_minutes BETWEEN 5 AND 720);

-- ============================================================
-- ROLLBACK (solo si algo sale mal; NO se ejecuta solo)
--
--   ALTER TABLE ai_agents
--     DROP COLUMN IF EXISTS action_tags,
--     DROP COLUMN IF EXISTS action_fields,
--     DROP COLUMN IF EXISTS action_assign,
--     DROP COLUMN IF EXISTS action_close,
--     DROP COLUMN IF EXISTS action_notes,
--     DROP COLUMN IF EXISTS exit_message,
--     DROP COLUMN IF EXISTS response_quality,
--     DROP COLUMN IF EXISTS max_reply_buttons,
--     DROP COLUMN IF EXISTS max_reminders,
--     DROP COLUMN IF EXISTS follow_up_delay_minutes;
--   DROP TABLE IF EXISTS ai_agent_source_access;
--   DROP TABLE IF EXISTS ai_qa_pairs;
--   DROP TABLE IF EXISTS ai_knowledge_sources;
-- ============================================================
