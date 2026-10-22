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

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // El canal vive en la conversación, no en el mensaje: el agente
    // responde (o no) según el hilo completo.
    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_reply_count, ai_processing_at, channel')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return

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

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) {
      await db.from('conversations').update({ ai_processing_at: null }).eq('id', conversationId)
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
            ai_processing_at: null,
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
        await db
          .from('conversations')
          .update({ ai_processing_at: null })
          .eq('id', conversationId)
        return
      }
      await sendAiReply({
        accountId,
        conversationId,
        text: turn.reply,
      })
      await db
        .from('conversations')
        .update({ ai_processing_at: null })
        .eq('id', conversationId)
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
      await db
        .from('conversations')
        .update({ ai_autoreply_disabled: true, ai_processing_at: null })
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
      await db.from('conversations').update({ ai_processing_at: null }).eq('id', conversationId)
      return
    }

    await sendAiReply({
      accountId,
      conversationId,
      text,
    })

    await db.from('conversations').update({ ai_processing_at: null }).eq('id', conversationId)
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
    try {
      const db = supabaseAdmin()
      await db.from('conversations').update({ ai_processing_at: null }).eq('id', conversationId)
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
