import { NextResponse, after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { channelsAdmin } from '@/lib/channels/admin-client'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { decrypt } from '@/lib/whatsapp/encryption'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import {
  verifyMetaSignature,
  extractInboundMessages,
  fetchUserName,
  type MetaInboundMessage,
} from '@/lib/channels/meta'
import { ensureLeadForContactRow } from '@/lib/leads/ensure-lead'
import { syncContactAvatar } from '@/lib/avatar/sync'

// ============================================================
// GET/POST /api/webhooks/meta/[id] — webhook de Meta para los canales
// Instagram Direct y Facebook Messenger.
//
// `id` es el id de la fila `channel_configs` (unguessable). Meta primero
// verifica el endpoint con un GET (hub.verify_token) y luego entrega los
// mensajes por POST firmados con el App Secret del canal
// (X-Hub-Signature-256). Traducimos los eventos a contactos,
// conversaciones y mensajes reutilizando el mismo esquema que WhatsApp.
// ============================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// La ingesta es rápida; la respuesta de IA puede llamar a un proveedor
// externo. `after()` la ejecuta después de responderle a Meta sin
// bloquear su ventana de reintentos.
export const maxDuration = 60

interface IngestedInbound {
  conversationId: string
  contactId: string
  contentType: string
  text: string | null
}

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
    .in('channel', ['instagram', 'facebook'])
    .maybeSingle()
  if (error) {
    console.error('[meta-webhook] config error:', error)
    return null
  }
  return data
}

// ---- Verificación (GET) ---------------------------------------

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const challenge = searchParams.get('hub.challenge')
  const verifyToken = searchParams.get('hub.verify_token')

  if (mode !== 'subscribe' || !challenge || !verifyToken) {
    return NextResponse.json(
      { error: 'Missing verification parameters' },
      { status: 400 },
    )
  }

  const cfg = await loadChannel(channelsAdmin(), id)
  if (!cfg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const config = (cfg.config ?? {}) as Record<string, unknown>
  const expected =
    typeof config.verify_token === 'string' ? config.verify_token : ''

  if (!expected || expected !== verifyToken) {
    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 },
    )
  }

  return new Response(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// ---- Entrega de mensajes (POST) -------------------------------

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Body crudo ANTES de parsear: la firma se calcula sobre los bytes
  // exactos que Meta firmó.
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  const admin = channelsAdmin()
  const cfg = await loadChannel(admin, id)
  if (!cfg || !cfg.is_active) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const config = (cfg.config ?? {}) as Record<string, unknown>
  const appSecret =
    safeDecrypt(config.app_secret) || process.env.META_APP_SECRET || ''

  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    console.warn('[meta-webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const events = extractInboundMessages(payload)
  if (events.length === 0) {
    return NextResponse.json({ status: 'ok', handled: 0 })
  }

  console.info('[meta-webhook] received', {
    config: id,
    object: (payload as { object?: string })?.object ?? null,
    events: events.length,
  })

  const accountId = cfg.account_id as string
  const ownerUserId = await resolveOwnerUserId(admin, accountId)
  if (!ownerUserId) {
    console.error('[meta-webhook] no owner for account', accountId)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }

  const accessToken = safeDecrypt(config.access_token)

  const delivered: IngestedInbound[] = []
  for (const ev of events) {
    try {
      const ingested = await ingestMessage(
        admin,
        accountId,
        ownerUserId,
        accessToken,
        ev,
      )
      if (ingested) delivered.push(ingested)
    } catch (err) {
      console.error('[meta-webhook] ingest failed:', err)
    }
  }

  // IA después de responderle a Meta. Solo mensajes de texto nuevos:
  // los adjuntos no se reenvían al modelo y los duplicados ya se
  // filtraron en la ingesta.
  after(async () => {
    for (const item of delivered) {
      if (item.contentType !== 'text' || !item.text?.trim()) continue
      try {
        await dispatchInboundToAiReply({
          accountId,
          conversationId: item.conversationId,
          contactId: item.contactId,
          configOwnerUserId: ownerUserId,
        })
      } catch (err) {
        console.error('[meta-webhook] ai auto-reply failed:', err)
      }
    }
  })

  return NextResponse.json({ status: 'received', handled: events.length })
}

function mapContent(ev: MetaInboundMessage): {
  contentType: string
  text: string | null
  mediaUrl: string | null
} {
  if (!ev.attachmentUrl) {
    return { contentType: 'text', text: ev.text, mediaUrl: null }
  }
  const map: Record<string, string> = {
    image: 'image',
    video: 'video',
    audio: 'audio',
    file: 'document',
    fallback: 'text',
  }
  const contentType =
    (ev.attachmentType && map[ev.attachmentType]) || 'text'
  const text =
    ev.text ?? (contentType === 'text' ? '[Archivo adjunto]' : null)
  return { contentType, text, mediaUrl: ev.attachmentUrl }
}

async function ingestMessage(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  accessToken: string,
  ev: MetaInboundMessage,
): Promise<IngestedInbound | null> {
  const channel = ev.channel

  // Idempotencia: Meta reintenta; no dupliquemos por mid.
  if (ev.messageId) {
    const { data: dup } = await admin
      .from('messages')
      .select('id')
      .eq('message_id', ev.messageId)
      .limit(1)
    if (dup && dup.length > 0) return null
  }

  // ¿Hilo existente para este usuario de la plataforma?
  const { data: existingConv } = await admin
    .from('conversations')
    .select('id, contact_id, unread_count')
    .eq('account_id', accountId)
    .eq('channel', channel)
    .eq('external_contact_id', ev.senderId)
    .limit(1)
    .maybeSingle()

  let conversationId: string | null = existingConv?.id ?? null
  let contactId: string | null = (existingConv?.contact_id as string) ?? null
  let unreadCount = (existingConv?.unread_count as number) ?? 0

  if (!contactId) {
    const name = accessToken
      ? await fetchUserName(ev.senderId, accessToken)
      : null
    const { data: created, error } = await admin
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        phone: null,
        name: name || ev.senderId,
      })
      .select('id')
      .single()
    if (error || !created) {
      console.error('[meta-webhook] contact insert error:', error)
      return null
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
        channel,
        external_contact_id: ev.senderId,
      })
      .select('id, unread_count')
      .single()
    if (error || !newConv) {
      console.error('[meta-webhook] conversation insert error:', error)
      return null
    }
    conversationId = newConv.id as string
    unreadCount = (newConv.unread_count as number) ?? 0
    await dispatchWebhookEvent(admin, accountId, 'conversation.created', {
      conversation_id: conversationId,
      contact_id: contactId,
      channel,
    })
  }

  // Lead automático + foto de perfil — best-effort, nunca romper la
  // ingesta. Para IG/FB intentamos la foto por Graph API.
  try {
    await ensureLeadForContactRow(admin, accountId, ownerUserId, contactId, channel)
  } catch (err) {
    console.warn('[meta-webhook] ensureLead failed:', err)
  }
  try {
    void syncContactAvatar(admin, accountId, {
      id: contactId,
      avatar_url: null,
      phone: null,
    }).catch((err: unknown) =>
      console.warn('[meta-webhook] avatar sync failed:', err)
    )
  } catch (err) {
    console.warn('[meta-webhook] avatar sync threw:', err)
  }

  const { contentType, text, mediaUrl } = mapContent(ev)
  const createdAt = new Date(ev.timestamp).toISOString()

  const { error: msgErr } = await admin.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: contentType,
    content_text: text,
    media_url: mediaUrl,
    message_id: ev.messageId,
    status: 'delivered',
    channel,
    created_at: createdAt,
  })
  if (msgErr) {
    console.error('[meta-webhook] message insert error:', msgErr)
    return null
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
    message_id: ev.messageId,
    channel,
    text,
  })

  if (!conversationId || !contactId) return null
  return { conversationId, contactId, contentType, text }
}
