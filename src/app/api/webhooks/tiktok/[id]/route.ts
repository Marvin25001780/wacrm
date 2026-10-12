import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { channelsAdmin } from '@/lib/channels/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import {
  verifyTikTokSignature,
  extractTikTokEvents,
  isAuthorizationRemoved,
  TIKTOK_SIGNATURE_HEADER,
  TIKTOK_WEBHOOK_ACK,
  type TikTokInboundMessage,
} from '@/lib/channels/tiktok'

// ============================================================
// POST /api/webhooks/tiktok/[id] — webhook de TikTok para la
// mensajería directa (Business Messaging API, acceso de partner).
//
// `id` es el id de la fila `channel_configs` (unguessable), igual que en
// el webhook de Meta. TikTok firma cada entrega en la cabecera
// `tiktok-signature` (HMAC-SHA256 con el client_secret); verificamos esa
// firma antes de procesar nada y traducimos los eventos a contactos,
// conversaciones y mensajes con el mismo esquema que WhatsApp/Meta.
//
// Nota: la mensajería de TikTok exige acceso de partner aprobado; hasta
// entonces este endpoint no recibe tráfico real, pero queda listo y
// verificado.
// ============================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function safeDecrypt(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  try {
    return decrypt(value)
  } catch {
    return ''
  }
}

async function resolveOwnerUserId(
  admin: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data: owner } = await admin
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .eq('account_role', 'owner')
    .limit(1)
    .maybeSingle()
  if (owner?.user_id) return owner.user_id as string

  const { data: any } = await admin
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle()
  return (any?.user_id as string | undefined) ?? null
}

async function loadChannel(admin: SupabaseClient, id: string) {
  const { data, error } = await admin
    .from('channel_configs')
    .select('id, account_id, channel, config, is_active')
    .eq('id', id)
    .eq('channel', 'tiktok')
    .maybeSingle()
  if (error) {
    console.error('[tiktok-webhook] config error:', error)
    return null
  }
  return data
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!UUID_RE.test(id)) return ack()

  // Body crudo ANTES de parsear: la firma se calcula sobre los bytes
  // exactos que TikTok firmó.
  const rawBody = await request.text()
  const signature = request.headers.get(TIKTOK_SIGNATURE_HEADER)

  const admin = channelsAdmin()
  const cfg = await loadChannel(admin, id)
  if (!cfg) return ack()

  const config = (cfg.config ?? {}) as Record<string, unknown>
  const secret =
    safeDecrypt(config.webhook_secret) ||
    process.env.TIKTOK_WEBHOOK_SECRET ||
    process.env.TIKTOK_CLIENT_SECRET ||
    ''

  if (!verifyTikTokSignature(rawBody, signature, secret)) {
    console.warn('[tiktok-webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (!cfg.is_active) return ack()

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return ack()
  }

  const events = extractTikTokEvents(payload)
  const accountId = cfg.account_id as string

  // Retirada de autorización: desconectamos el canal.
  if (events.some(isAuthorizationRemoved)) {
    await admin
      .from('channel_configs')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    return ack()
  }

  const messages = events
    .map((ev) => ev.message)
    .filter((m): m is TikTokInboundMessage => Boolean(m && m.senderId))

  if (messages.length > 0) {
    const ownerUserId = await resolveOwnerUserId(admin, accountId)
    if (ownerUserId) {
      for (const msg of messages) {
        try {
          await ingestMessage(admin, accountId, ownerUserId, msg)
        } catch (err) {
          console.error('[tiktok-webhook] ingest failed:', err)
        }
      }
    } else {
      console.error('[tiktok-webhook] no owner for account', accountId)
    }
  }

  return ack()
}

function ack() {
  return NextResponse.json(TIKTOK_WEBHOOK_ACK)
}

async function ingestMessage(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  msg: TikTokInboundMessage,
) {
  // Idempotencia: TikTok reintenta; no dupliquemos por message_id.
  if (msg.messageId) {
    const { data: dup } = await admin
      .from('messages')
      .select('id')
      .eq('message_id', msg.messageId)
      .limit(1)
    if (dup && dup.length > 0) return
  }

  const { data: existingConv } = await admin
    .from('conversations')
    .select('id, contact_id, unread_count')
    .eq('account_id', accountId)
    .eq('channel', 'tiktok')
    .eq('external_contact_id', msg.senderId)
    .limit(1)
    .maybeSingle()

  let conversationId: string | null = existingConv?.id ?? null
  let contactId: string | null = (existingConv?.contact_id as string) ?? null
  let unreadCount = (existingConv?.unread_count as number) ?? 0

  if (!contactId) {
    const { data: created, error } = await admin
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        phone: null,
        name: msg.senderId,
      })
      .select('id')
      .single()
    if (error || !created) {
      console.error('[tiktok-webhook] contact insert error:', error)
      return
    }
    contactId = created.id as string
  }

  if (!conversationId) {
    const { data: newConv, error } = await admin
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        contact_id: contactId,
        channel: 'tiktok',
        external_contact_id: msg.senderId,
      })
      .select('id, unread_count')
      .single()
    if (error || !newConv) {
      console.error('[tiktok-webhook] conversation insert error:', error)
      return
    }
    conversationId = newConv.id as string
    unreadCount = (newConv.unread_count as number) ?? 0
    await dispatchWebhookEvent(admin, accountId, 'conversation.created', {
      conversation_id: conversationId,
      contact_id: contactId,
      channel: 'tiktok',
    })
  }

  const contentType = msg.mediaUrl ? 'image' : 'text'
  const text = msg.text ?? (msg.mediaUrl ? '[Archivo adjunto]' : null)
  const createdAt = new Date(msg.timestamp).toISOString()

  const { error: msgErr } = await admin.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: contentType,
    content_text: text,
    media_url: msg.mediaUrl,
    message_id: msg.messageId,
    status: 'delivered',
    channel: 'tiktok',
    created_at: createdAt,
  })
  if (msgErr) {
    console.error('[tiktok-webhook] message insert error:', msgErr)
    return
  }

  await admin
    .from('conversations')
    .update({
      last_message_text: text || `[${contentType}]`,
      last_message_at: createdAt,
      unread_count: unreadCount + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)

  await dispatchWebhookEvent(admin, accountId, 'message.received', {
    conversation_id: conversationId,
    contact_id: contactId,
    message_id: msg.messageId,
    channel: 'tiktok',
    text,
  })
}
