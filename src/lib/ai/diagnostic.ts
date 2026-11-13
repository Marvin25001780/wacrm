// ============================================================
// Diagnóstico de respuestas automáticas.
//
// El motor de IA tiene varias guardas que pueden dejarlo en
// silencio sin ningún error visible: interruptor maestro apagado,
// respuestas automáticas apagadas, clave ilegible, agente activo
// sin el canal WhatsApp, una automatización que se adueña de todos
// los mensajes, o un hilo ya derivado a un humano.
//
// Esta capa reúne todas esas condiciones en una lista de chequeos
// para que Ajustes → Asistente de IA pueda decir exactamente cuál
// está bloqueando, en vez de dejar al usuario adivinando.
//
// No expone credenciales: solo booleanos y el nombre del agente.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { loadActiveAgent } from './agent-prompt'
import { agentChannels } from './channels'
import { AI_PROVIDER_DEFAULT_MODEL } from './defaults'
import { transcriptionProvider } from './transcribe'

export type DiagnosticStatus = 'ok' | 'warn' | 'fail'

/**
 * Cómo nombrar un mensaje entrante que no es texto. El motor de IA solo
 * recibe `content_text`, así que un audio o una imagen sin pie nunca
 * llegan al modelo y el hilo parece "mudo" sin ningún error.
 */
const MEDIA_LABEL: Record<string, string> = {
  image: 'una imagen',
  video: 'un video',
  audio: 'un audio',
  document: 'un documento',
  sticker: 'un sticker',
  location: 'una ubicación',
  contact: 'un contacto',
}

export interface DiagnosticCheck {
  id: string
  label: string
  status: DiagnosticStatus
  detail: string
}

export interface DiagnosticConversation {
  id: string
  contactName: string | null
  phone: string | null
  channel: string | null
  lastMessageText: string | null
  lastCustomerMessageAt: string | null
  lastCustomerContentType: string | null
  lastBotMessageAt: string | null
  aiReplyCount: number
  assignedToHuman: boolean
  autoReplyDisabled: boolean
  reason: string
  answered: boolean
}

export interface AiDiagnostic {
  ok: boolean
  checkedAt: string
  checks: DiagnosticCheck[]
  agent: { id: string; name: string; channels: string[] } | null
  maxReplies: number
  conversations: DiagnosticConversation[]
}

interface AiConfigRow {
  provider: string
  model: string
  api_key: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
}

interface ConversationRow {
  id: string
  contact_id: string | null
  assigned_agent_id: string | null
  ai_reply_count: number | null
  ai_autoreply_disabled: boolean | null
  channel: string | null
  last_message_text: string | null
  updated_at: string | null
}

export async function buildAiDiagnostic(
  db: SupabaseClient,
  accountId: string,
): Promise<AiDiagnostic> {
  const checks: DiagnosticCheck[] = []

  const { data: cfgData, error: cfgError } = await db
    .from('ai_configs')
    .select(
      'provider, model, api_key, is_active, auto_reply_enabled, auto_reply_max_per_conversation',
    )
    .eq('account_id', accountId)
    .maybeSingle()

  const cfg = (cfgData as AiConfigRow | null) ?? null
  const maxReplies = cfg?.auto_reply_max_per_conversation ?? 3

  if (cfgError) {
    checks.push({
      id: 'config',
      label: 'Configuración de IA',
      status: 'fail',
      detail: `No se pudo leer la configuración: ${cfgError.message}`,
    })
  } else if (!cfg) {
    checks.push({
      id: 'config',
      label: 'Configuración de IA',
      status: 'fail',
      detail:
        'No hay proveedor ni clave guardados. Guarda una clave de OpenAI, Gemini, DeepSeek, Groq o Anthropic.',
    })
  } else {
    checks.push({
      id: 'provider',
      label: 'Proveedor y modelo',
      status: cfg.model?.trim() ? 'ok' : 'fail',
      detail: cfg.model?.trim()
        ? `${cfg.provider} · ${cfg.model}`
        : 'Falta el nombre del modelo.',
    })

    checks.push({
      id: 'active',
      label: 'Interruptor principal',
      status: cfg.is_active ? 'ok' : 'fail',
      detail: cfg.is_active
        ? 'El asistente de IA está activo.'
        : 'Está apagado. Sin esto, ni los borradores ni las respuestas automáticas funcionan.',
    })

    checks.push({
      id: 'auto_reply',
      label: 'Respuestas automáticas',
      status: cfg.auto_reply_enabled ? 'ok' : 'fail',
      detail: cfg.auto_reply_enabled
        ? `Activadas, máximo ${maxReplies} respuestas por conversación.`
        : 'Están apagadas: el bot solo redacta borradores, nunca envía solo.',
    })

    // Las notas de voz son la mitad de un WhatsApp real. Sin un
    // proveedor con endpoint de audio, el bot sigue sordo a ellas.
    const voiceProvider = transcriptionProvider(cfg.provider)
    checks.push({
      id: 'transcription',
      label: 'Transcripción de audios',
      status: voiceProvider ? 'ok' : 'warn',
      detail: voiceProvider
        ? `Los audios se transcriben con ${
            voiceProvider === 'openai' ? 'OpenAI' : 'Groq'
          } antes de responder.`
        : `«${cfg.provider}» no transcribe notas de voz. Cambia a OpenAI o Groq para que el bot entienda los audios.`,
    })

    if (!cfg.api_key) {
      checks.push({
        id: 'key',
        label: 'Clave del proveedor',
        status: 'fail',
        detail: 'No hay clave guardada.',
      })
    } else {
      try {
        decrypt(cfg.api_key)
        checks.push({
          id: 'key',
          label: 'Clave del proveedor',
          status: 'ok',
          detail: 'La clave se descifra correctamente.',
        })
      } catch {
        checks.push({
          id: 'key',
          label: 'Clave del proveedor',
          status: 'fail',
          detail:
            'La clave guardada no se puede descifrar. Suele pasar cuando cambió ENCRYPTION_KEY: vuelve a guardar la clave de IA.',
        })
      }
    }
  }

  // ---- Modelo recomendado ------------------------------------
  // Los IDs retirados suelen dejar de enrutar sin avisar, y el
  // síntoma es exactamente este: silencio.
  if (cfg && cfg.provider in AI_PROVIDER_DEFAULT_MODEL) {
    const recommended =
      AI_PROVIDER_DEFAULT_MODEL[
        cfg.provider as keyof typeof AI_PROVIDER_DEFAULT_MODEL
      ]
    if (cfg.model && cfg.model !== recommended) {
      checks.push({
        id: 'model',
        label: 'Modelo recomendado',
        status: 'warn',
        detail: `Usas «${cfg.model}». Si el proveedor lo rechaza (un alias retirado, por ejemplo), cambia a «${recommended}».`,
      })
    }
  }

  // ---- Función que reserva el turno del bot -------------------
  // Sin `claim_ai_reply_slot` el motor genera la respuesta y la
  // descarta: el usuario solo ve silencio. Se comprueba con un id
  // inexistente y tope 0, así no toca ninguna fila.
  const { error: slotError } = await db.rpc('claim_ai_reply_slot', {
    conversation_id: '00000000-0000-0000-0000-000000000000',
    max_replies: 0,
  })
  if (!slotError) {
    checks.push({
      id: 'slot',
      label: 'Reserva de turno del bot',
      status: 'ok',
      detail: 'La función claim_ai_reply_slot existe.',
    })
  } else if (slotError.code === 'PGRST202') {
    checks.push({
      id: 'slot',
      label: 'Reserva de turno del bot',
      status: 'fail',
      detail:
        'Falta la función claim_ai_reply_slot en la base. Ejecuta la migración 029_ai_reply.sql: sin ella la IA genera respuestas y las descarta.',
    })
  } else {
    checks.push({
      id: 'slot',
      label: 'Reserva de turno del bot',
      status: 'warn',
      detail: `No se pudo comprobar la función: ${slotError.message}`,
    })
  }

  // ---- Canales conectados ------------------------------------
  const { data: waRows } = await db
    .from('whatsapp_config')
    .select('id')
    .eq('account_id', accountId)
    .limit(1)
  const metaConnected = (waRows?.length ?? 0) > 0

  const { data: evoRows } = await db
    .from('channel_configs')
    .select('id')
    .eq('account_id', accountId)
    .eq('channel', 'evolution')
    .eq('is_active', true)
    .limit(1)
  const evolutionConnected = (evoRows?.length ?? 0) > 0

  checks.push({
    id: 'channel',
    label: 'WhatsApp conectado',
    status: metaConnected || evolutionConnected ? 'ok' : 'fail',
    detail: metaConnected
      ? `Meta Cloud API${evolutionConnected ? ' y Evolution' : ''}.`
      : evolutionConnected
        ? 'Evolution API (WhatsApp por QR).'
        : 'No hay WhatsApp conectado. El bot no tiene por dónde enviar.',
  })

  // ---- Agente activo -----------------------------------------
  const agent = await loadActiveAgent(db, accountId)
  const channels = agent ? agentChannels(agent.channels) : []

  if (agent) {
    const coversWhatsapp = channels.includes('whatsapp')
    checks.push({
      id: 'agent',
      label: 'Agente de IA',
      status: coversWhatsapp ? 'ok' : 'fail',
      detail: coversWhatsapp
        ? `«${agent.name}» responde en ${channels.join(', ')}.`
        : `«${agent.name}» está activo pero no tiene marcado el canal WhatsApp. Edítalo y activa ese canal.`,
    })
  } else {
    checks.push({
      id: 'agent',
      label: 'Agente de IA',
      status: 'warn',
      detail:
        'No hay agente activo. Se usará el prompt global de esta pantalla, solo en WhatsApp.',
    })
  }

  // ---- Automatizaciones que se adueñan del mensaje -----------
  const { data: autoResponders } = await db
    .from('automations')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .in('trigger_type', ['new_message_received', 'keyword_match'])
    .limit(5)

  if (autoResponders && autoResponders.length > 0) {
    checks.push({
      id: 'automations',
      label: 'Automatizaciones',
      status: 'fail',
      detail: `Hay ${autoResponders.length} automatización(es) activa(s) con disparador de mensaje (${autoResponders
        .map((row) => (row as { name?: string }).name ?? 'sin nombre')
        .join(', ')}). Mientras existan, la IA no responde. Desactívalas si quieres que conteste el bot.`,
    })
  } else {
    checks.push({
      id: 'automations',
      label: 'Automatizaciones',
      status: 'ok',
      detail: 'Ninguna automatización está interceptando los mensajes.',
    })
  }

  // ---- Flujos activos ----------------------------------------
  // Un flujo que toma el mensaje (menú, palabra clave) lo saca del
  // camino de la IA: el webhook no la invoca para ese mensaje.
  const { count: activeFlows } = await db
    .from('flows')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('status', 'active')

  if ((activeFlows ?? 0) > 0) {
    checks.push({
      id: 'flows',
      label: 'Flujos activos',
      status: 'warn',
      detail: `Hay ${activeFlows} flujo(s) activo(s). Si uno toma el mensaje por menú o palabra clave, la IA no responde a ese mensaje. Desactívalos si quieres que conteste el bot.`,
    })
  }

  // Una conversación con un flujo EN CURSO queda fuera del camino de la
  // IA: el flujo "consume" cada mensaje aunque ya no envíe nada. Un run
  // abandonado deja el hilo mudo para siempre.
  const { count: activeRuns } = await db
    .from('flow_runs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('status', 'active')

  if ((activeRuns ?? 0) > 0) {
    checks.push({
      id: 'flow_runs',
      label: 'Conversaciones dentro de un flujo',
      status: 'warn',
      detail: `Hay ${activeRuns} conversación(es) con un flujo en curso. Mientras el flujo tenga el hilo, la IA no responde ahí aunque el flujo ya no envíe mensajes.`,
    })
  }

  // ---- Hilos recientes ---------------------------------------
  const { data: convData } = await db
    .from('conversations')
    .select(
      'id, contact_id, assigned_agent_id, ai_reply_count, ai_autoreply_disabled, channel, last_message_text, updated_at',
    )
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false })
    .limit(6)

  const convRows = (convData ?? []) as ConversationRow[]
  const conversations: DiagnosticConversation[] = []

  if (convRows.length > 0) {
    const contactIds = [
      ...new Set(convRows.map((row) => row.contact_id).filter(Boolean)),
    ] as string[]
    const convIds = convRows.map((row) => row.id)

    const contactRows: Array<{
      id: string
      name: string | null
      phone: string | null
    }> = []

    if (contactIds.length > 0) {
      const { data: contacts } = await db
        .from('contacts')
        .select('id, name, phone')
        .in('id', contactIds)
      for (const row of contacts ?? []) {
        contactRows.push(
          row as { id: string; name: string | null; phone: string | null },
        )
      }
    }

    const { data: messages } = await db
      .from('messages')
      .select('conversation_id, sender_type, created_at, content_type, content_text')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(200)

    const contactById = new Map(contactRows.map((row) => [row.id, row]))

    interface LastCustomerMessage {
      at: string
      contentType: string | null
      text: string | null
    }

    const lastCustomer = new Map<string, LastCustomerMessage>()
    const lastBot = new Map<string, string>()
    for (const raw of messages ?? []) {
      const msg = raw as {
        conversation_id: string
        sender_type: string
        created_at: string
        content_type: string | null
        content_text: string | null
      }
      if (msg.sender_type === 'customer' && !lastCustomer.has(msg.conversation_id)) {
        lastCustomer.set(msg.conversation_id, {
          at: msg.created_at,
          contentType: msg.content_type,
          text: msg.content_text,
        })
      }
      if (msg.sender_type === 'bot' && !lastBot.has(msg.conversation_id)) {
        lastBot.set(msg.conversation_id, msg.created_at)
      }
    }

    for (const row of convRows) {
      const contact = row.contact_id ? contactById.get(row.contact_id) : undefined
      const customer = lastCustomer.get(row.id) ?? null
      const customerAt = customer?.at ?? null
      const botAt = lastBot.get(row.id) ?? null
      const customerMediaOnly =
        customer != null &&
        !customer.text?.trim() &&
        customer.contentType != null &&
        customer.contentType !== 'text'

      let reason = 'Listo para responder.'
      let answered = false
      if (row.assigned_agent_id) {
        reason = 'Asignada a un humano: el bot no interviene.'
      } else if ((row.ai_reply_count ?? 0) >= maxReplies) {
        reason = `Alcanzó el máximo de ${maxReplies} respuestas del bot en este hilo.`
      } else if (customerAt && botAt && botAt > customerAt) {
        reason = 'El bot ya respondió al último mensaje del cliente.'
        answered = true
      } else if (customerAt && customerMediaOnly) {
        reason =
          customer.contentType === 'audio'
            ? 'El último mensaje del cliente fue un audio que no se pudo transcribir. Revisa el chequeo «Transcripción de audios».'
            : `El último mensaje del cliente fue ${
                MEDIA_LABEL[customer.contentType as string] ?? 'un archivo'
              } sin texto: la IA solo lee texto, así que no lo procesa.`
      } else if (customerAt) {
        reason = 'El último mensaje del cliente quedó sin respuesta.'
      }

      conversations.push({
        id: row.id,
        contactName: contact?.name ?? null,
        phone: contact?.phone ?? null,
        channel: row.channel,
        lastMessageText: row.last_message_text,
        lastCustomerMessageAt: customerAt,
        lastCustomerContentType: customer?.contentType ?? null,
        lastBotMessageAt: botAt,
        aiReplyCount: row.ai_reply_count ?? 0,
        assignedToHuman: Boolean(row.assigned_agent_id),
        autoReplyDisabled: Boolean(row.ai_autoreply_disabled),
        reason,
        answered,
      })
    }
  }

  return {
    ok: checks.every((check) => check.status !== 'fail'),
    checkedAt: new Date().toISOString(),
    checks,
    agent: agent
      ? { id: agent.id, name: agent.name, channels }
      : null,
    maxReplies,
    conversations,
  }
}
