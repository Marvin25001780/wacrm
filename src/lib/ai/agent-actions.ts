// ============================================================
// Acciones del agente (A3) — protocolo + ejecutor.
//
// El agente puede MANIPULAR el CRM, no solo contestar. La via es un
// protocolo JSON en la propia respuesta (no function-calling nativo):
// funciona idéntico con los 5 proveedores del registry (Groq/OpenAI/
// Anthropic/Gemini/DeepSeek) sin configurar tools por proveedor.
// Si el modelo no devuelve JSON válido, la respuesta se trata como
// texto plano — nunca se pierde el mensaje del cliente por un mal
// parseo.
//
// Envolvente que se le pide al modelo:
//   {"reply": "<texto al cliente>", "actions": [{"type": "...", "value": {...}}]}
//
// Ejecutor: cada acción se aplica con el cliente de la llamada —
// service-role en el motor real (comportamiento con bypass de RLS
// intencional; así funciona todo el motor de mensajería) o el cliente
// autenticado en el simulador, donde RLS es la barrera que evita que
// un agente/viewer mueva lo que no debe.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export type AgentActionType =
  | 'add_tag'
  | 'update_contact'
  | 'assign_conversation'
  | 'close_conversation'
  | 'add_note'

export interface AgentAction {
  type: AgentActionType
  value?: string | Record<string, unknown>
}

export interface AgentActionSpec {
  allowed: AgentActionType[]
  /** Instrucciones de protocolo (normas por tipo). */
  rules: string
}

export function buildActionProtocol(spec: AgentActionSpec): string {
  const lines = spec.allowed
    .map((t) => `{"type": "${t}", "value": ...}`)
    .join(', ')
  return [
    'You may perform actions on the CRM. Reply with ONE JSON object and nothing else, exactly shaped:',
    `{"reply": "<the message the customer will actually see>", "actions": [<actions>]}`,
    `Allowed action shapes: ${lines}.`,
    `Action rules: ${spec.rules}`,
    'Add an action ONLY when the customer clearly confirmed or asked for it. If no actions are needed use "actions": []. Always include "reply" with a natural customer-facing message.',
  ].join('\n')
}

/** Filtra y normaliza lo que el modelo devuelve como actions. */
export function parseAgentActions(
  raw: unknown,
  allowed: AgentActionType[]
): AgentAction[] {
  if (!Array.isArray(raw)) return []
  const set = new Set<AgentActionType>(allowed)
  const out: AgentAction[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { type, value } = item as { type?: unknown; value?: unknown }
    if (typeof type !== 'string' || !set.has(type as AgentActionType)) continue
    out.push({
      type: type as AgentActionType,
      value:
        typeof value === 'string'
          ? value
          : value && typeof value === 'object'
            ? (value as Record<string, unknown>)
            : undefined,
    })
  }
  return out
}

/**
 * Extrae la envolvente JSON de la respuesta del modelo. Con texto
 * plano devuelve la respuesta tal cual (sin acciones): el parseo es
 * opportunist, no destructivo.
 */
export function parseAgentReply(
  raw: string,
  allowed: AgentActionType[]
): { text: string; actions: AgentAction[] } {
  const trimmed = raw.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { text: trimmed, actions: [] }
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      reply?: unknown
      actions?: unknown
    }
    if (typeof parsed.reply !== 'string') {
      return { text: trimmed, actions: [] }
    }
    return {
      text: parsed.reply,
      actions: parseAgentActions(parsed.actions, allowed),
    }
  } catch {
    return { text: trimmed, actions: [] }
  }
}

// ============================================================
// EJECUTOR
// ============================================================

export interface AgentActionContext {
  accountId: string
  conversationId: string
  contactId: string
  /** Quien firma las filas (el dueño del config en el motor real). */
  userId: string
}

export interface AppliedAction {
  type: AgentActionType
  ok: boolean
  detail?: string
}

async function ensureTag(
  db: SupabaseClient,
  accountId: string,
  name: string
): Promise<{ id: string } | null> {
  const clean = name.trim().slice(0, 60)
  if (!clean) return null

  const { data: existing } = await db
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .ilike('name', clean)
    .limit(1)

  const rows = (existing ?? []) as { id: string }[]
  if (rows[0]) return rows[0]

  // Colores fijos de la paleta de espacios (spaces/colors) — no importa
  // exactamente cuál: es la etiqueta nueva de la conversación.
  const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
  const color = palette[clean.length % palette.length]
  const { data: created, error } = await db
    .from('tags')
    .insert({ account_id: accountId, name: clean, color })
    .select('id')
    .single()
  if (error || !created) {
    console.error('[agent-actions] tag create failed:', error?.message)
    return null
  }
  return created as { id: string }
}

async function executeAction(
  db: SupabaseClient,
  action: AgentAction,
  ctx: AgentActionContext
): Promise<AppliedAction> {
  try {
    switch (action.type) {
      case 'add_tag': {
        const name = typeof action.value === 'string' ? action.value : (action.value as { name?: unknown })?.name
        if (typeof name !== 'string' || !name.trim()) {
          return { type: action.type, ok: false, detail: 'sin nombre' }
        }
        const tag = await ensureTag(db, ctx.accountId, name)
        if (!tag) return { type: action.type, ok: false, detail: 'no se pudo resolver la etiqueta' }
        const { error } = await db
          .from('contact_tags')
          .upsert(
            { contact_id: ctx.contactId, tag_id: tag.id },
            { onConflict: 'contact_id,tag_id' }
          )
        if (error) return { type: action.type, ok: false, detail: error.message }
        return { type: action.type, ok: true, detail: name.trim() }
      }

      case 'update_contact': {
        if (typeof action.value !== 'object' || !action.value) {
          return { type: action.type, ok: false, detail: 'sin campos' }
        }
        const fields = action.value as Record<string, unknown>
        // Campos safe-listed: el modelo NO decide el teléfono ni el
        // account; name/email/company son los campos de所谓 contacto.
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
        for (const key of ['name', 'email', 'company'] as const) {
          const v = fields[key]
          if (typeof v === 'string' && v.trim()) update[key] = v.trim().slice(0, 120)
        }
        if (Object.keys(update).length === 1) {
          return { type: action.type, ok: false, detail: 'sin campos válidos' }
        }
        const { error } = await db
          .from('contacts')
          .update(update)
          .eq('id', ctx.contactId)
          .eq('account_id', ctx.accountId)
        if (error) return { type: action.type, ok: false, detail: error.message }
        return { type: action.type, ok: true }
      }

      case 'assign_conversation': {
        // El asignado es un usuario de la cuenta (id) — el modelo no
        // inventa: se le pasa el id exacto.
        if (typeof action.value !== 'string' || !action.value.trim()) {
          return { type: action.type, ok: false, detail: 'sin usuario' }
        }
        const { error } = await db
          .from('conversations')
          .update({ assigned_agent_id: action.value.trim() })
          .eq('id', ctx.conversationId)
          .eq('account_id', ctx.accountId)
        if (error) return { type: action.type, ok: false, detail: error.message }
        return { type: action.type, ok: true }
      }

      case 'close_conversation': {
        const { error } = await db
          .from('conversations')
          .update({ status: 'closed' })
          .eq('id', ctx.conversationId)
          .eq('account_id', ctx.accountId)
        if (error) return { type: action.type, ok: false, detail: error.message }
        return { type: action.type, ok: true }
      }

      case 'add_note': {
        const text =
          typeof action.value === 'string' ? action.value : (action.value as { text?: unknown })?.text
        if (typeof text !== 'string' || !text.trim()) {
          return { type: action.type, ok: false, detail: 'sin texto' }
        }
        const { error } = await db.from('contact_notes').insert({
          contact_id: ctx.contactId,
          user_id: ctx.userId,
          note_text: text.trim().slice(0, 2000),
        })
        if (error) return { type: action.type, ok: false, detail: error.message }
        return { type: action.type, ok: true }
      }

      default:
        return { type: action.type, ok: false, detail: 'tipo desconocido' }
    }
  } catch (err) {
    return { type: action.type, ok: false, detail: String(err) }
  }
}

/**
 * Aplica las acciones del turno y devuelve el resultado de cada una,
 * para que la UI muestre "aplicó etiqueta X" y no un resumen opaco.
 */
export async function applyAgentActions(
  db: SupabaseClient,
  actions: AgentAction[],
  ctx: AgentActionContext
): Promise<AppliedAction[]> {
  const results: AppliedAction[] = []
  for (const action of actions) {
    results.push(await executeAction(db, action, ctx))
  }
  return results
}
