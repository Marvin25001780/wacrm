// ============================================================
// Turno del agente (A2+A3+A4 en un solo motor).
//
// Tanto el SIMULADOR (chat de la derecha del editor) como el MOTOR
// REAL (auto-reply del webhook) recorren la MISMA función:
//   agente → conocimiento → prompt → proveedor → acciones → texto.
// Antes vivían separadas (el simulador usaba una copia del prompt y
// el motor el global) y por eso el simulador mentía respecto de lo
// que manejaba la bandeja.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAiConfig } from './config'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import {
  buildAgentSystemPrompt,
  type AiAgentRow,
} from './agent-prompt'
import { loadAgentKnowledge } from './knowledge'
import {
  applyAgentActions,
  buildActionProtocol,
  parseAgentReply,
  type AgentActionType,
  type AppliedAction,
} from './agent-actions'

export interface AgentTurnOptions {
  /** Ejecutar las acciones que pida el modelo. Sin `ctx` no puede:
   *  el simulador (sin conversación real) reporta, el motor aplica. */
  execute?: boolean
  ctx?: {
    conversationId: string
    contactId: string
    userId: string
  }
}

export interface AgentTurnResult {
  reply: string
  handoff: boolean
  knowledgeLoaded: boolean
  actions: AgentActionType[]
  applied?: AppliedAction[]
}

export class AgentTurnError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'AgentTurnError'
    this.code = code
  }
}

/**
 * Un turno completo del agente. Lanza AgentTurnError si la IA de la
 * cuenta no está configurada para hablar con un proveedor
 * (code = 'ai_not_configured') o si el proveedor falla de verdad.
 * Los fallos de conocimiento/acciones degradan sin lanzar.
 */
export async function runAgentTurn(
  db: SupabaseClient,
  agent: AiAgentRow,
  messages: { role: 'user' | 'assistant'; content: string }[],
  options: AgentTurnOptions = { execute: true }
): Promise<AgentTurnResult> {
  const accountId = agent.account_id
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const userText = lastUser?.content ?? ''

  // ---- Config global (proveedor + modelo + llave) --------------
  // `loadAiConfig` lanza si la llave guardada no descifra (típico:
  // ENCRYPTION_KEY distinta o una llave escrita a mano en la base).
  // Sin este mapeo el simulador y el motor devolvían "Internal server
  // error" en vez de decir qué arreglar.
  const config = await loadAiConfig(db, accountId).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : ''
    if (message.startsWith('Encrypted token')) {
      throw new AgentTurnError(
        'La clave de IA guardada no se puede leer. Vuelve a guardarla en Configuración → Asistente de IA.',
        'ai_key_unreadable'
      )
    }
    throw err
  })
  if (!config) {
    throw new AgentTurnError(
      'El asistente de IA no tiene proveedor configurado (Configuración → Asistente de IA).',
      'ai_not_configured'
    )
  }

  // ---- Conocimiento (A2) --------------------------------------
  const knowledge = await loadAgentKnowledge(db, accountId, agent.id, userText)

  // ---- Acciones permitidas según las palancas (A3) -------------
  const allowedActions: AgentActionType[] = []
  if (agent.action_tags) allowedActions.push('add_tag')
  if (agent.action_fields) allowedActions.push('update_contact')
  if (agent.action_assign) allowedActions.push('assign_conversation')
  if (agent.action_close) allowedActions.push('close_conversation')
  if (agent.action_notes) allowedActions.push('add_note')

  // ---- Prompt --------------------------------------------------
  const personality = buildAgentSystemPrompt(agent, {
    exit_message: agent.exit_message,
    response_quality: agent.response_quality,
    max_reply_buttons: agent.max_reply_buttons,
    max_reminders: agent.max_reminders,
    follow_up_delay_minutes: agent.follow_up_delay_minutes,
  })
  const parts: string[] = []
  if (knowledge.blocks.length > 0) {
    parts.push(
      'Conocimiento del negocio (ÚSALO para responder; no inventes fuera de esto):\n' +
        knowledge.blocks.join('\n\n')
    )
  }
  if (knowledge.qa.length > 0) {
    parts.push(
      'Preguntas y respuestas verificadas del negocio (si el cliente pregunta algo de esto, copia la respuesta con ajustes mínimos):\n' +
        knowledge.qa.map((q) => `- Q: ${q.question}\n  A: ${q.answer}`).join('\n')
    )
  }
  if (allowedActions.length > 0) {
    parts.push(
      buildActionProtocol({
        allowed: allowedActions,
        rules:
          'add_tag: value es el NOMBRE de la etiqueta (se crea si no existe). update_contact: value es un objeto {"name"?, "email"?, "company"?}. assign_conversation: value es el ID del usuario (te lo dará el sistema; si no lo tienes, no uses esta acción). close_conversation: no lleva value. add_note: value es el texto de la NOTA INTERNA (visible solo para el equipo; no para el cliente).',
      })
    )
  }
  const extraContext = parts.join('\n\n')

  const systemPrompt = buildSystemPrompt({
    userPrompt:
      extraContext || personality
        ? [personality, extraContext].filter(Boolean).join('\n\n')
        : null,
    mode: 'auto_reply',
  })

  // ---- Generación ----------------------------------------------
  const { text, handoff: generatedHandoff } = await generateReply({
    config,
    systemPrompt,
    messages,
  })
  let handoff = generatedHandoff

  let reply = text
  let actionList: AgentActionType[] = []
  let applied: AppliedAction[] | undefined

  if (allowedActions.length > 0 && text && !handoff) {
    // El turno puede venir envuelto en JSON (protocolo de acciones).
    const parsed = parseAgentReply(text, allowedActions)
    // SIEMPRE se usa el texto de la envolvente, aunque no haya acciones:
    // el modelo responde `{"reply": "...", "actions": []}` y sin esto el
    // cliente recibiría el JSON crudo.
    reply = parsed.text
    actionList = parsed.actions.map((a) => a.type)
    if (options.execute && options.ctx && parsed.actions.length > 0) {
      applied = await applyAgentActions(db, parsed.actions, {
        accountId,
        conversationId: options.ctx.conversationId,
        contactId: options.ctx.contactId,
        userId: options.ctx.userId,
      })
    }
  }

  // Respuesta vacía (el modelo devolvió `"reply": ""`): si el agente
  // tiene mensaje de salida se usa ese y se marca handoff; si no, se
  // deja vacío para que el motor no envíe un mensaje en blanco.
  if (!handoff && !reply.trim()) {
    if (agent.exit_message) {
      reply = agent.exit_message
      handoff = true
    }
  }

  return {
    reply,
    handoff,
    knowledgeLoaded: knowledge.loaded,
    actions: actionList,
    applied,
  }
}
