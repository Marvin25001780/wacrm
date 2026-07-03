import { AiError, type ChatMessage } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] }
  finishReason?: string
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
}

function normalizeForGemini(messages: ChatMessage[]): { role: string; parts: { text: string }[] }[] {
  const merged = mergeConsecutive(messages)
  return merged.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
}

export async function generateGemini(args: ProviderArgs): Promise<string> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: normalizeForGemini(messages),
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Gemini', res)
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null
  const text = data?.candidates?.[0]?.content?.parts
    ?.filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim()

  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason
    if (reason && reason !== 'STOP') {
      throw new AiError(`Gemini stopped early: ${reason}`, { code: 'provider_error' })
    }
    throw new AiError('Gemini returned an empty response.', { code: 'empty_response' })
  }
  return text
}
