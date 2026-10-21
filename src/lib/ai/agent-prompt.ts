// ============================================================
// Agentes de IA — prompt + agente activo (compartido).
//
// Dos consumen esto:
//   1. el SIMULADOR  (editar agente → chat de prueba), siempre, y
//   2. el MOTOR REAL (auto-reply): si la cuenta tiene un agente
//      ACTIVO, su personalidad manda sobre el prompt global de
//      `ai_configs`. Sin agente activo, la cuenta conserva el
//      comportamiento de siempre.
//
// Ese era el hueco por el que "los agentes no funcionaban": se
// podían crear en la UI pero nada los usaba en la bandeja real
// — el motor solo leía el prompt global de la cuenta.
//
// Un solo agente activo por cuenta (el más antiguo con status
// 'active'): dos agentes activos a la vez no tienen un dueño claro
// en la conversación. Si mañana se pide "agente por canal", se
// reemplaza este helper — es su único punto de decisión.
// ============================================================

export interface AiAgentRow {
  id: string
  account_id: string
  created_by_user_id: string
  name: string
  description: string | null
  status: 'active' | 'inactive'
  objective: string | null
  behavior: string | null
  tone: string[] | null
  prohibited_rules: string[] | null
  // ---- A3: acciones que el modelo puede ejecutar (palancas) ----
  action_tags?: boolean
  action_fields?: boolean
  action_assign?: boolean
  action_close?: boolean
  action_notes?: boolean
  // ---- A4: ajustes finos de respuesta ---------------------------
  exit_message?: string | null
  response_quality?: 'concise' | 'balanced' | 'detailed' | null
  max_reply_buttons?: number | null
  max_reminders?: number | null
  follow_up_delay_minutes?: number | null
}

/**
 * El agente ACTIVO de la cuenta: el primero por antigüedad con
 * status 'active'. Devuelve null si no hay ninguno (el motor cae al
 * prompt global) o si falla la consulta (con un log — responder con
 * la personalidad equivocada no es opción).
 */
export async function loadActiveAgent(
  db: import('@supabase/supabase-js').SupabaseClient,
  accountId: string
): Promise<AiAgentRow | null> {
  const { data, error } = await db
    .from('ai_agents')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[agent-prompt] loadActiveAgent failed:', error.message)
    return null
  }
  const rows = (data ?? []) as AiAgentRow[]
  return rows[0] ?? null
}

/**
 * Prompt de personalidad del agente, a partir de sus campos:
 * objetivo → comportamiento → tono → reglas prohibidas. Vacío solo
 * cuando el agente no tiene NADA configurado (el llamador decide
 * si caer al prompt global o avisar).
 *
 * `advanced` (A4, opcional) suma las reglas de salida/calidad/
 * botones/recordatorios cuando el agente las tiene configuradas.
 */
export function buildAgentSystemPrompt(
  agent: Pick<
    AiAgentRow,
    'objective' | 'behavior' | 'tone' | 'prohibited_rules'
  >,
  advanced?: {
    exit_message?: string | null
    response_quality?: 'concise' | 'balanced' | 'detailed' | null
    max_reply_buttons?: number | null
    max_reminders?: number | null
    follow_up_delay_minutes?: number | null
  }
): string {
  const parts: string[] = []
  if (agent.objective) parts.push(`Objetivo:\n${agent.objective}`)
  if (agent.behavior) parts.push(`Comportamiento:\n${agent.behavior}`)
  if (agent.tone && agent.tone.length > 0) {
    parts.push(`Tono: ${agent.tone.join(', ')}`)
  }
  if (agent.prohibited_rules && agent.prohibited_rules.length > 0) {
    parts.push(
      `Reglas prohibidas:\n- ${agent.prohibited_rules.join('\n- ')}`
    )
  }

  const adv = advanced
  if (adv) {
    if (adv.response_quality === 'concise') {
      parts.push(
        'Estilo de respuesta: MUY conciso — frases cortas de WhatsApp, sin párrafos largos ni detalle innecesario.'
      )
    } else if (adv.response_quality === 'detailed') {
      parts.push(
        'Estilo de respuesta: detallado — explica opciones y próximos pasos con claridad, sin sobrepasarte.'
      )
    }
    if (adv.exit_message && adv.exit_message.trim()) {
      parts.push(
        `Cuando consideres que tu objetivo está alcanzado, cierra la conversación con este mensaje final (y después deja el turno al humano):\n"${adv.exit_message.trim()}"`
      )
    }
    const maxButtons = adv.max_reply_buttons ?? 2
    if (maxButtons > 0) {
      parts.push(
        `Puedes proponerle al cliente hasta ${maxButtons} ${maxButtons === 1 ? 'opción' : 'opciones'} de respuesta (opciones breves, separadas por guiones con "Opciones:") — nunca más.`
      )
    }
    const maxRem = adv.max_reminders ?? 2
    const delay = adv.follow_up_delay_minutes ?? 30
    if (maxRem > 0) {
      parts.push(
        `Si el cliente deja de responder, puedes enviar hasta ${maxRem} recordatorio${maxRem === 1 ? '' : 's'} con al menos ${delay} minutos entre uno y otro. Nunca más de ${maxRem}.`
      )
    }
  }

  return parts.join('\n\n')
}
