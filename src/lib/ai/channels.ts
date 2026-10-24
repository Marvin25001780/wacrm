// ============================================================
// Canales del agente de IA.
//
// El agente solo responde en los canales que el usuario elige al
// activarlo. En esta primera versión son cuatro canales con envío
// conversacional real:
//   - whatsapp  (Meta Cloud API o Evolution)
//   - sms       (textbee)
//   - instagram (Meta Send API)
//   - facebook  (Meta Send API)
//
// Email no tiene integración conversacional, webchat es captación de
// leads y TikTok no puede enviar DMs sin acceso partner; por eso no
// aparecen aquí.
// ============================================================

export const AI_AGENT_CHANNELS = [
  'whatsapp',
  'sms',
  'instagram',
  'facebook',
] as const

export type AiAgentChannel = (typeof AI_AGENT_CHANNELS)[number]

export interface AiChannelStatus {
  whatsapp: boolean
  sms: boolean
  instagram: boolean
  facebook: boolean
}

export const AI_AGENT_CHANNEL_META: Record<
  AiAgentChannel,
  { label: string; description: string }
> = {
  whatsapp: {
    label: 'WhatsApp',
    description: 'Responde por WhatsApp Cloud API o Evolution.',
  },
  sms: {
    label: 'SMS',
    description: 'Responde por el gateway de SMS (textbee).',
  },
  instagram: {
    label: 'Instagram',
    description: 'Responde los mensajes directos de Instagram.',
  },
  facebook: {
    label: 'Facebook',
    description: 'Responde los mensajes de Facebook Messenger.',
  },
}

export function isAiAgentChannel(value: unknown): value is AiAgentChannel {
  return (
    typeof value === 'string' &&
    (AI_AGENT_CHANNELS as readonly string[]).includes(value)
  )
}

/**
 * Normaliza lo que venga de la base o del cliente: descarta canales
 * desconocidos, quita duplicados y conserva el orden del catálogo.
 */
export function normalizeAiAgentChannels(value: unknown): AiAgentChannel[] {
  if (!Array.isArray(value)) return []
  const selected = new Set<AiAgentChannel>()
  for (const item of value) {
    if (isAiAgentChannel(item)) selected.add(item)
  }
  return AI_AGENT_CHANNELS.filter((channel) => selected.has(channel))
}

/**
 * Canales efectivos de un agente. Las filas anteriores a la migración
 * 071 no tienen `channels`; para no cambiar el comportamiento que ya
 * tenía Sofía, se interpretan como `{whatsapp}`.
 */
export function agentChannels(value: unknown): AiAgentChannel[] {
  const normalized = normalizeAiAgentChannels(value)
  return normalized.length > 0 ? normalized : ['whatsapp']
}

/**
 * Canal de una conversación. `conversations.channel` puede ser nulo en
 * filas antiguas: ahí el comportamiento histórico era WhatsApp.
 * Canales fuera del catálogo (email, webchat, tiktok) devuelven null y
 * el motor no responde por ellos.
 */
export function normalizeConversationChannel(
  value: unknown,
): AiAgentChannel | null {
  if (value === null || value === undefined || value === '') return 'whatsapp'
  return isAiAgentChannel(value) ? value : null
}

/** ¿El agente debe atender un mensaje de este canal? */
export function agentRespondsOn(
  agent: { channels?: unknown },
  conversationChannel: unknown,
): boolean {
  const channel = normalizeConversationChannel(conversationChannel)
  if (!channel) return false
  return agentChannels(agent.channels).includes(channel)
}
