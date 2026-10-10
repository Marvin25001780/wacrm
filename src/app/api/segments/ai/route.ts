import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import {
  SEGMENT_FIELDS,
  validateRules,
  OPERATOR_LABEL,
} from '@/lib/segments/rules'
import type { SegmentEntity, SegmentRule } from '@/types'

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function isEntity(v: unknown): v is SegmentEntity {
  return v === 'contacts' || v === 'leads'
}

/** Extrae el primer arreglo JSON de un texto que puede venir con ```. */
function extractJsonArray(text: string): unknown[] | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * POST /api/segments/ai
 * Traduce una descripción en lenguaje natural a reglas de segmento
 * usando la IA configurada por la cuenta (BYO key). No guarda nada.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const limited = checkRateLimit(
      `segments-ai:${ctx.userId}`,
      RATE_LIMITS.aiDraft,
    )
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    if (!isEntity(body.entity)) return bad('entity debe ser "contacts" o "leads"')
    const description =
      typeof body.description === 'string' ? body.description.trim() : ''
    if (!description) return bad('Describe el segmento que quieres crear')

    const config = await loadAiConfig(ctx.supabase, ctx.accountId)
    if (!config) {
      return bad(
        'La IA no está configurada. Actívala en Configuración → Asistente IA.',
        409,
      )
    }

    const fields = SEGMENT_FIELDS[body.entity]
      .map(
        (f) =>
          `- ${f.key} (${f.label}): operadores ${f.operators
            .map((o) => `${o}="${OPERATOR_LABEL[o]}"`)
            .join(', ')}${f.options ? `; valores: ${f.options.join(', ')}` : ''}`,
      )
      .join('\n')

    const systemPrompt = [
      'Eres un asistente que traduce descripciones en lenguaje natural a un',
      'arreglo JSON de condiciones de segmento.',
      `Entidad: ${body.entity} (tabla "${body.entity}").`,
      'Campos permitidos y sus operadores:',
      fields,
      '',
      'Devuelve EXCLUSIVAMENTE el arreglo JSON, sin explicaciones ni texto adicional.',
      'Cada elemento: {"field": "...", "operator": "...", "value": "..."}',
      'Omite "value" en los operadores is_set / is_not_set.',
      'Máximo 8 condiciones. Usa lógica AND implícita.',
    ].join('\n')

    const result = await generateReply({
      config,
      systemPrompt,
      messages: [{ role: 'user', content: description }],
    })

    const raw = extractJsonArray(result.text)
    if (!raw) {
      return bad('La IA no devolvió un segmento válido. Intenta de nuevo.')
    }

    const checked = validateRules(body.entity, raw)
    if (!checked.ok) {
      return bad(`La IA generó reglas no válidas: ${checked.error}`)
    }

    return NextResponse.json({ rules: checked.rules as SegmentRule[] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
