-- 064_messages_interactive_payload.sql
--
-- `src/lib/whatsapp/send-message.ts` stores the structured payload of an
-- outbound interactive message (button / list) next to its plain-text body
-- so the thread can re-render the buttons/rows on reload. The column was
-- referenced in code but no earlier migration ever created it, so EVERY
-- outbound insert failed on PostgREST with:
--
--   Could not find the 'interactive_payload' column of 'messages'
--   in the schema cache
--
-- PostgREST rejects the whole INSERT when any referenced column is unknown,
-- even when the value is NULL — which is why plain text replies (which send
-- `interactive_payload: null`) broke too and the message disappeared from
-- the CRM even though Meta accepted it.
--
-- Additive only: safe to run on any environment (dev / production).

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS interactive_payload JSONB;
