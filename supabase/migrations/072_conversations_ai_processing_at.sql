-- ============================================================
-- 072 — conversations.ai_processing_at
--
-- El motor de IA usa esta columna como lock en vuelo: al tomar un
-- mensaje entrante escribe NOW(); si otro webhook del mismo hilo llega
-- antes de 90 s, se descarta. También se limpia al terminar.
--
-- La columna se usa en `src/lib/ai/auto-reply.ts` desde el commit de
-- A2/A3/A4 (070), pero ninguna migración la creaba. Consecuencia: el
-- SELECT fallaba con 42703, `dispatchInboundToAiReply` lo trataba como
-- "conversación no encontrada" y salía en silencio — la IA no respondía
-- ningún mensaje.
--
-- Idempotente: se puede aplicar sobre producción y sobre una base que
-- ya la tenga.
-- ============================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_processing_at timestamptz;

COMMENT ON COLUMN public.conversations.ai_processing_at IS
  'Lock en vuelo del motor de IA: timestamp de la toma actual. Se limpia al terminar; si supera 90 s se considera abandonado.';

-- Índice parcial: solo interesan las filas con lock activo.
CREATE INDEX IF NOT EXISTS idx_conversations_ai_processing_at
  ON public.conversations (ai_processing_at)
  WHERE ai_processing_at IS NOT NULL;
