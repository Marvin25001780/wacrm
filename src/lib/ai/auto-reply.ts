import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { engineSendText } from '@/lib/flows/meta-send'
const AUTO_REPLY_COOLDOWN_MS = 30_000

interface DispatchArgs {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
}

export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_processing_at')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return
    if (conv.ai_autoreply_disabled) return
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    // Flag atomico: si ya se esta procesando una respuesta, salta
    if (conv.ai_processing_at) {
      const elapsed = Date.now() - new Date(conv.ai_processing_at).getTime()
      if (elapsed < AUTO_REPLY_COOLDOWN_MS) return
    }

    // Marcar que empezamos a procesar
    await db
      .from('conversations')
      .update({ ai_processing_at: new Date().toISOString() })
      .eq('id', conversationId)
      .is('ai_processing_at', null)

    // Verificar si otro proceso se nos adelanto
    const { data: verify } = await db
      .from('conversations')
      .select('ai_processing_at')
      .eq('id', conversationId)
      .maybeSingle()
    if (!verify?.ai_processing_at) {
      await db.from('conversations').update({ ai_processing_at: null }).eq('id', conversationId)
      return
    }

    const ourTime = Date.now()
    const theirTime = new Date(verify.ai_processing_at).getTime()
    if (ourTime - theirTime > 3000) {
      await db.from('conversations').update({ ai_processing_at: null }).eq('id', conversationId)
      return
    }

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) {
      await db.from('conversations').update({ ai_processing_at: null }).eq('id', conversationId)
      return
    }

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

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
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
