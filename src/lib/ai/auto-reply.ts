import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { loadActiveAgent } from './agent-prompt'
import { agentRespondsOn, normalizeConversationChannel } from './channels'
import { runAgentTurn } from './agent-turn'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'

interface DispatchArgs {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
}

interface ReplyConversationRow {
  assigned_agent_id: string | null
  ai_reply_count: number
  ai_processing_at?: string | null
  channel: string | null
}

const CONVERSATION_COLUMNS =
  'assigned_agent_id, ai_reply_count, ai_processing_at, channel'

// Sin la migración 072 la columna del lock no existe. La IA debe seguir
// respondiendo igual: el lock evita duplicados, no es un requisito para
// contestar.
const CONVERSATION_COLUMNS_WITHOUT_LOCK =
  'assigned_agent_id, ai_reply_count, channel'

/**
 * Carga el hilo con la columna del lock y, si la base aún no tiene la
 * migración 072 (`42703 undefined_column`), reintenta sin ella. Antes
 * este SELECT fallaba y el motor lo interpretaba como "conversación no
 * encontrada": la IA se apagaba en silencio.
 */
async function loadConversationForReply(
  db: import('@supabase/supabase-js').SupabaseClient,
  conversationId: string,
): Promise<{ conv: ReplyConversationRow | null; lockSupported: boolean }> {
  const first = await db
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', conversationId)
    .maybeSingle()

  if (!first.error) {
    return { conv: (first.data as ReplyConversationRow | null), lockSupported: true }
  }

  if (first.error.code === '42703') {
    console.warn(
      '[ai auto-reply] conversations.ai_processing_at no existe; sigo sin lock. Aplica la migración 072.',
    )
    const legacy = await db
      .from('conversations')
      .select(CONVERSATION_COLUMNS_WITHOUT_LOCK)
      .eq('id', conversationId)
      .maybeSingle()
    if (legacy.error) {
      console.error(
        '[ai auto-reply] conversation lookup failed:',
        legacy.error.message,
      )
      return { conv: null, lockSupported: false }
    }
    return {
      conv: (legacy.data as ReplyConversationRow | null),
      lockSupported: false,
    }
  }

  console.error(
    '[ai auto-reply] conversation lookup failed:',
    first.error.message,
  )
  return { conv: null, lockSupported: true }
}


/**
 * Responde automáticamente (o no) a un mensaje entrante de la cuenta.
 *
 * Dos caminos:
 *   1. la cuenta tiene un agente ACTIVO → turno completo del agente
 *      (personalidad, conocimiento A2, acciones A3, avanzada A4);
 *   2. sin agente → el prompt global de `ai_configs`, como siempre.
 *
 * El agente solo atiende los canales que eligió al activarse. El
 * prompt global se conserva únicamente para WhatsApp: SMS, Instagram
 * y Facebook no respondían con IA antes de esta versión.
 *
 * Guardas del motor (comunes a ambos): no si una automatización de
 * nivel mensaje está activa, no si el hilo ya tiene humano asignado,
 * tope de respuestas por conversación, lock de 90s
 * (`ai_processing_at`) y slot atómico (`claim_ai_reply_slot`).
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  let lockSupported = true

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // El canal vive en la conversación, no en el mensaje: el agente
    // responde (o no) según el hilo completo.
    const loaded = await loadConversationForReply(db, conversationId)
    const conv = loaded.conv
    lockSupported = loaded.lockSupported
    if (!conv) return

    // Limpia el lock del hilo cuando la base lo soporta. En modo legacy
    // (sin migración 072) no hay nada que limpiar.
    const clearLock = async () => {
      if (!lockSupported) return
      await db
        .from('conversations')
        .update({ ai_processing_at: null })
        .eq('id', conversationId)
    }

    const conversationChannel = normalizeConversationChannel(conv.channel)
    const agent = await loadActiveAgent(db, accountId)

    if (agent) {
      if (!agentRespondsOn(agent, conversationChannel)) return
    } else if (conversationChannel !== 'whatsapp') {
      // Sin agente, el prompt global mantiene su alcance histórico:
      // solo WhatsApp. Los demás canales necesitan un agente activo
      // con ese canal seleccionado.
      return
    }

    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    // Resetear disabled siempre al recibir un nuevo mensaje de un canal
    // que este agente atiende.
    await db
      .from('conversations')
      .update({ ai_autoreply_disabled: false })
      .eq('id', conversationId)

    if (conv.assigned_agent_id) return
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    if (lockSupported) {
      const now = Date.now()
      const processingAt = conv.ai_processing_at
        ? new Date(conv.ai_processing_at).getTime()
        : null

      if (processingAt) {
        const age = now - processingAt
        if (age < 90_000) return
      }

      // Lock atómico optimista: dos entregas del webhook no generan dos
      // respuestas del bot sobre el mismo mensaje.
      const { data: locked } = await db
        .from('conversations')
        .update({ ai_processing_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('ai_processing_at', conv.ai_processing_at)
        .select('id')
        .maybeSingle()
      if (!locked) return
    }

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) {
      await clearLock()
      return
    }

    if (agent) {
      // ---------- CAMINO 1: turno del agente activo ----------
      let turn
      try {
        turn = await runAgentTurn(db, agent, messages, {
          execute: true,
          ctx: {
            conversationId,
            contactId,
            userId: configOwnerUserId,
          },
        })
      } catch (turnErr) {
        // El lock se libera en el catch de abajo (una sola vía).
        throw turnErr
      }

      if (turn.handoff || !turn.reply) {
        await sendAiReplySafe({
          accountId,
          conversationId,
          text: turn.reply,
        })
        await db
          .from('conversations')
          .update({
            ai_autoreply_disabled: true,
            ...(lockSupported ? { ai_processing_at: null } : {}),
          })
          .eq('id', conversationId)
        return
      }

      const { data: claimed, error: claimErr } = await db.rpc(
        'claim_ai_reply_slot',
        {
          conversation_id: conversationId,
          max_replies: config.autoReplyMaxPerConversation,
        },
      )
      if (claimErr || claimed !== true) {
        await clearLock()
        return
      }
      await sendAiReply({
        accountId,
        conversationId,
        text: turn.reply,
      })
      await clearLock()
      return
    }

    // ---------- CAMINO 2: prompt global (como siempre) ----------
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
    })

    const { text, handoff } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    if (handoff || !text) {
      if (text) {
        await sendAiReply({
          accountId,
          conversationId,
          text,
        })
      }
      const { error: handoffErr } = await db
        .from('conversations')
        .update({
          ai_autoreply_disabled: true,
          ...(lockSupported ? { ai_processing_at: null } : {}),
        })
        .eq('id', conversationId)
      if (handoffErr) {
        console.error('[ai auto-reply] handoff update failed:', handoffErr.message)
      }
      return
    }

    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr || claimed !== true) {
      await clearLock()
      return
    }

    await sendAiReply({
      accountId,
      conversationId,
      text,
    })

    await clearLock()
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
    try {
      const db = supabaseAdmin()
      if (lockSupported) {
        await db
          .from('conversations')
          .update({ ai_processing_at: null })
          .eq('id', conversationId)
      }
    } catch {}
  }
}

/**
 * Envía la respuesta por el canal real del hilo (WhatsApp, SMS,
 * Instagram o Facebook) y la firma como `bot`. Usa el mismo núcleo que
 * la bandeja, así respeta la línea de WhatsApp del hilo, Evolution,
 * credenciales y persistencia.
 */
async function sendAiReply(args: {
  accountId: string
  conversationId: string
  text: string
}): Promise<void> {
  await sendMessageToConversation(supabaseAdmin(), args.accountId, {
    conversationId: args.conversationId,
    messageType: 'text',
    contentText: args.text,
    senderId: null,
    senderType: 'bot',
  })
}

async function sendAiReplySafe(args: {
  accountId: string
  conversationId: string
  text: string | null | undefined
}): Promise<void> {
  if (!args.text) return
  await sendAiReply({
    accountId: args.accountId,
    conversationId: args.conversationId,
    text: args.text,
  })
}
