import { AiError, type AiConfig, type AiProvider, type ChatMessage, type GenerateResult } from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateGemini } from './providers/gemini'
import { generateDeepSeek } from './providers/deepseek'
import { generateGroq } from './providers/groq'
import type { ProviderArgs } from './providers/shared'

/**
 * Provider registry. Adding a provider is a two-line change: import its
 * adapter and add it here (plus its default model in `defaults.ts`).
 */
const PROVIDERS: Record<AiProvider, (args: ProviderArgs) => Promise<string>> = {
  openai: generateOpenAi,
  anthropic: generateAnthropic,
  gemini: generateGemini,
  deepseek: generateDeepSeek,
  groq: generateGroq,
}

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Failures worth retrying on the fallback model: transient upstream
 * conditions (timeout, network, rate limit, provider 5xx). Auth failures
 * and empty responses are *not* retried — the fallback would fail the
 * same way, and we'd rather surface the real error immediately.
 */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof AiError)) return false
  if (err.code === 'timeout' || err.code === 'network_error') return true
  if (err.code === 'rate_limited') return true
  if (err.code === 'provider_error' && err.status >= 500) return true
  return false
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. When a `fallbackModel` is configured and the primary
 * model fails with a retryable error, the call is retried once with the
 * fallback model (same provider/key) — the "hybrid" resilience path.
 * Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()

  const adapter = PROVIDERS[config.provider]
  if (!adapter) {
    throw new AiError(`Unsupported AI provider: ${config.provider}`, {
      code: 'unsupported_provider',
      status: 400,
    })
  }

  const run = (model: string) =>
    adapter({ apiKey: config.apiKey, model, systemPrompt, messages, timeoutMs })

  let raw: string
  try {
    raw = await run(config.model)
  } catch (err) {
    const fallback = config.fallbackModel?.trim()
    if (fallback && fallback !== config.model && isRetryable(err)) {
      console.warn(
        `[ai] primary model "${config.model}" failed (${(err as AiError).code}); retrying with fallback "${fallback}"`,
      )
      raw = await run(fallback)
    } else {
      throw err
    }
  }

  return parseGeneration(raw)
}

/**
 * Split the raw model output into `{ text, handoff }`. The sentinel can
 * appear alone or trailing a partial reply; either way we treat the
 * turn as a handoff and strip the marker from any remaining text.
 */
export function parseGeneration(raw: string): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff }
}
