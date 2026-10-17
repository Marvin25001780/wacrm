import { NextResponse } from 'next/server'
import { channelsAdmin } from '@/lib/channels/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { extractDirectMediaUrl } from '@/lib/channels/evolution'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureLeadForContactRow } from '@/lib/leads/ensure-lead'
import { syncContactAvatar } from '@/lib/avatar/sync'

// ============================================================
// POST /api/webhooks/evolution/[id]  —  ingesta de Evolution API
//
// Evolution API (WhatsApp no oficial / Baileys) apunta sus webhooks a
// esta URL. `id` es el id de la fila `channel_configs` (unguessable) y
// además verificamos el header `apikey` contra el api_key guardado.
//
// Traduce eventos `messages.upsert` a contactos, conversaciones y
// mensajes en el CRM, reutilizando exactamente los mismos helpers de
// de-duplicación que el webhook de WhatsApp Cloud. Los grupos y los
// ecos de mensajes propios (`fromMe`) se ignoran.
// ============================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Tipos de contenido permitidos por el CHECK de `messages` (migración 010). */
const ALLOWED_CONTENT_TYPES = new Set([
  'text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive',
])

interface EvolutionMessage {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string }
  pushName?: string
  message?: Record<string, unknown>
  messageTimestamp?: number | string
}

function extractContent(message: Record<string, unknown>): {
  type: string
  text: string | null
  mediaUrl: string | null
  filename: string | null
} {
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v : null

  // Si Evolution incluye una URL directa en el mensaje multimedia, la
  // guardamos para mostrar/descargar el archivo sin tener que pedírsela
  // de nuevo a la instancia.
  const direct = extractDirectMediaUrl(message)
  if (direct.url) {
    return {
      type: direct.type,
      text: direct.caption,
      mediaUrl: direct.url,
      filename: direct.filename,
    }
  }

  if (typeof message.conversation === 'string') {
    return { type: 'text', text: message.conversation, mediaUrl: null, filename: null }
  }
  const ext = message.extendedTextMessage as Record<string, unknown> | undefined
  if (ext && typeof ext.text === 'string')
    return { type: 'text', text: ext.text, mediaUrl: null, filename: null }

  const img = message.imageMessage as Record<string, unknown> | undefined
  if (img) return { type: 'image', text: str(img.caption), mediaUrl: null, filename: str(img.fileName) }
  const vid = message.videoMessage as Record<string, unknown> | undefined
  if (vid) return { type: 'video', text: str(vid.caption), mediaUrl: null, filename: str(vid.fileName) }
  const doc = message.documentMessage as Record<string, unknown> | undefined
  if (doc)
    return {
      type: 'document',
      text: str(doc.caption) ?? str(doc.fileName),
      mediaUrl: null,
      filename: str(doc.fileName) ?? str(doc.title),
    }
  const aud = message.audioMessage as Record<string, unknown> | undefined
  if (aud) return { type: 'audio', text: null, mediaUrl: null, filename: null }
  const sticker = message.stickerMessage as Record<string, unknown> | undefined
  if (sticker) return { type: 'image', text: null, mediaUrl: null, filename: null }

  return { type: 'text', text: null, mediaUrl: null, filename: null }
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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const admin = channelsAdmin()
  const { data: cfg, error: cfgErr } = await admin
    .from('channel_configs')
    .select('account_id, config, is_active')
    .eq('id', id)
    .eq('channel', 'evolution')
    .maybeSingle()

  if (cfgErr) {
    console.error('[evolution-webhook] config error:', cfgErr)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
  if (!cfg || !cfg.is_active) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const config = (cfg.config ?? {}) as Record<string, unknown>
  const expectedKey =
    typeof config.api_key === 'string' ? decrypt(config.api_key) : ''
  // Evolution v1/v2 usa `apikey`; algunos proxies/versiones envían `api_key`.
  const suppliedKey = request.headers.get('apikey') ?? request.headers.get('api_key') ?? ''
  if (expectedKey && suppliedKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = (await request.json().catch(() => null)) as
    | { event?: string; data?: EvolutionMessage }
    | null
  if (!payload) {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 })
  }

  // Solo nos interesan los mensajes entrantes.
  if (payload.event && payload.event !== 'messages.upsert') {
    return NextResponse.json({ ignored: payload.event })
  }

  const msg = payload.data
  const remoteJid = msg?.key?.remoteJid ?? ''
  if (!msg || !remoteJid) return NextResponse.json({ ignored: 'no-message' })

  // Grupos y ecos de mensajes propios.
  if (remoteJid.endsWith('@g.us')) return NextResponse.json({ ignored: 'group' })
  if (msg.key?.fromMe) return NextResponse.json({ ignored: 'from-me' })

  const phone = remoteJid.split('@')[0]
  if (!phone) return NextResponse.json({ ignored: 'no-phone' })

  const accountId = cfg.account_id as string

  // Idempotencia: Evolution reintenta; no dupliquemos por message_id.
  const waMessageId = msg.key?.id ?? null
  if (waMessageId) {
    const { data: dup } = await admin
      .from('messages')
      .select('id')
      .eq('message_id', waMessageId)
      .maybeSingle()
    if (dup) return NextResponse.json({ duplicate: true })
  }

  const ownerUserId = await resolveOwnerUserId(admin, accountId)
  if (!ownerUserId) {
    console.error('[evolution-webhook] no owner for account', accountId)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }

  const displayName = msg.pushName?.trim() || phone

  // Contacto
  let contactId: string
  const existing = await findExistingContact(admin, accountId, phone)
  if (existing) {
    contactId = existing.id
    if (displayName && displayName !== existing.name) {
      await admin
        .from('contacts')
        .update({ name: displayName, updated_at: new Date().toISOString() })
        .eq('id', contactId)
    }
  } else {
    const { data: created, error: createErr } = await admin
      .from('contacts')
      .insert({ account_id: accountId, user_id: ownerUserId, phone, name: displayName })
      .select('id')
      .single()
    if (createErr || !created) {
      if (isUniqueViolation(createErr)) {
        const raced = await findExistingContact(admin, accountId, phone)
        if (!raced) {
          return NextResponse.json({ error: 'Error' }, { status: 500 })
        }
        contactId = raced.id
      } else {
        console.error('[evolution-webhook] contact insert error:', createErr)
        return NextResponse.json({ error: 'Error' }, { status: 500 })
      }
    } else {
      contactId = created.id as string
    }
  }

  // Conversación — hilo `whatsapp` propio (un contacto puede tener
  // además hilo SMS/IG/FB). external_contact_id = número.
  const { data: existingConv } = await admin
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let conversation = existingConv
  if (!conversation) {
    const { data: newConv, error: convErr } = await admin
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        contact_id: contactId,
        channel: 'whatsapp',
        external_contact_id: phone,
      })
      .select('*')
      .single()
    if (convErr || !newConv) {
      console.error('[evolution-webhook] conversation insert error:', convErr)
      return NextResponse.json({ error: 'Error' }, { status: 500 })
    }
    conversation = newConv
    await dispatchWebhookEvent(admin, accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactId,
      channel: 'evolution',
    })
  }

  // Lead automático + foto de perfil — best-effort, nunca romper la
  // ingesta. Evolution expone la foto real de WhatsApp del contacto.
  try {
    await ensureLeadForContactRow(admin, accountId, ownerUserId, contactId, 'whatsapp')
  } catch (err) {
    console.warn('[evolution-webhook] ensureLead failed:', err)
  }
  try {
    void syncContactAvatar(admin, accountId, {
      id: contactId,
      avatar_url: null,
      phone,
    }).catch((err: unknown) =>
      console.warn('[evolution-webhook] avatar sync failed:', err)
    )
  } catch (err) {
    console.warn('[evolution-webhook] avatar sync threw:', err)
  }

  // Mensaje
  const raw = extractContent(msg.message ?? {})
  const contentType = ALLOWED_CONTENT_TYPES.has(raw.type) ? raw.type : 'text'
  const ts = msg.messageTimestamp
  const createdAt = ts
    ? new Date(Number(ts) * 1000).toISOString()
    : new Date().toISOString()

  const { error: msgErr } = await admin.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: raw.text,
    media_url: raw.mediaUrl,
    message_id: waMessageId,
    status: 'delivered',
    created_at: createdAt,
  })
  if (msgErr) {
    console.error('[evolution-webhook] message insert error:', msgErr)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }

  await admin
    .from('conversations')
    .update({
      last_message_text: raw.text || `[${contentType}]`,
      last_message_at: createdAt,
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  await dispatchWebhookEvent(admin, accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactId,
    message_id: waMessageId,
    channel: 'evolution',
  })

  return NextResponse.json({ received: true, contact_id: contactId })
}
