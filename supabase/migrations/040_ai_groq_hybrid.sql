-- ============================================================
-- 040_ai_groq_hybrid.sql — Groq provider + hybrid fallback
--
-- Extends the AI reply assistant (029) with:
--   - Groq as a fifth bring-your-own-key provider (fast open-weight
--     models such as Llama), alongside OpenAI / Anthropic / Gemini /
--     DeepSeek.
--   - `fallback_model`: an optional second model on the *same*
--     provider. When the primary model fails with a transient error
--     (timeout, network, rate limit, provider 5xx), `generateReply`
--     retries once with the fallback model before giving up — the
--     "IA híbrida" resilience path. NULL / empty disables it.
--
-- The `ai_configs.provider` CHECK was created inline in 029, so its
-- auto-generated name is `ai_configs_provider_check`. Drop-then-add
-- keeps this migration idempotent.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini', 'deepseek', 'groq'));

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS fallback_model text;
