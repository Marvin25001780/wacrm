// ============================================================
// SMS persistence — mirror textbee sends/receives into the CRM.
//
// SMS previously proxied textbee live and left no server-side trace,
// so the channel showed up empty in the shared inbox and in the
// "Mensajería por canal" metrics. This module records each send /
// receive as a real `messages` row (channel = 'sms') against the
// contact's conversation, so SMS threads appear in the inbox and
// count in the metrics widget just like WhatsApp.
//
// It reuses the exact conventions of the WhatsApp webhook / send core:
// the shared `findExistingContact` de-dup helper, the
// one-conversation-per-(account, contact) rule, and the
// account_id-tenancy / user_id-audit split. Chat history stays merged
// per contact (omnichannel); each message keeps its own `channel`.
//
// All functions throw on DB errors so callers can log — but callers
// invoke them best-effort, *after* the gateway call already happened,
// so a persistence hiccup never blocks an SMS that was really sent.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { formatPhone } from '@/lib/sms/textbee'
import { ensureLeadForContactRow } from '@/lib/leads/ensure-lead'

/** A received SMS normalised from a (slightly varying) textbee shape. */
export interface InboundSmsRecord {
  phone: string
  text: string
  messageId: string | null
  receivedAt: string
}

export interface StoredInboundSms {
  conversationId: string
  contactId: string
  text: string
}

export interface SmsSyncResult {
  stored: number
  skipped: number
  /** Mensajes nuevos, para que el llamador pueda disparar la IA. */
  storedMessages: StoredInboundSms[]
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Find or create the contact + conversation for an SMS phone number
 * within `accountId`. One conversation per (account, contact) — the
 * same rule the WhatsApp webhook uses — so an SMS to a number that
 * already has a WhatsApp thread lands in that thread.
 */
async function resolveConversation(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  phone: string,
  name?: string | null,
): Promise<{ conversationId: string; contactId: string }> {
  const formatted = formatPhone(phone)

  // ---- contact -------------------------------------------------
  let contactId: string
  const existing = await findExistingContact(db, accountId, formatted)
  if (existing) {
    contactId = existing.id
  } else {
    const { data: created, error } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: userId,
        phone: formatted,
        name: name || formatted,
      })
      .select('id')
      .single()

    if (error || !created) {
      // Lost a race against a concurrent create — the unique index
      // (migration 022) rejected the duplicate. Re-resolve.
      if (isUniqueViolation(error)) {
        const raced = await findExistingContact(db, accountId, formatted)
        if (!raced) throw new Error('Failed to create SMS contact')
        contactId = raced.id
      } else {
        console.error('[sms/persist] contact insert error:', error)
        throw error ?? new Error('Failed to create SMS contact')
      }
    } else {
      contactId = created.id as string
    }
  }

  // ---- conversation --------------------------------------------
  // Hilo propio del canal SMS (migration 049). Antes SMS caía en la
  // conversación WhatsApp del contacto; ahora cada medio tiene su hilo
  // (contacto + canal + external_contact_id) para la vista dividida.
  const { data: conv, error: convErr } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'sms')
    .maybeSingle()
  if (convErr) throw convErr
  if (conv?.id) {
    return { conversationId: conv.id as string, contactId }
  }

  const { data: newConv, error: createErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      channel: 'sms',
      external_contact_id: formatted,
    })
    .select('id')
    .single()
  if (createErr || !newConv) {
    // Carrera: otro webhook creó el hilo SMS justo antes.
    if (isUniqueViolation(createErr as { code?: string } | null) || !createErr) {
      const raced = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('channel', 'sms')
        .maybeSingle()
      if (raced.data?.id) {
        return { conversationId: raced.data.id as string, contactId }
      }
    }
    console.error('[sms/persist] conversation insert error:', createErr)
    throw createErr ?? new Error('Failed to create SMS conversation')
  }
  return { conversationId: newConv.id as string, contactId }
}

/**
 * Best-effort extraction of the gateway message id from a textbee send
 * response. textbee returns a batch object for sends, so this is only
 * a nicety (stored as `message_id` when present); a null is fine.
 */
export function extractGatewayMessageId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const root = data as Record<string, unknown>
  const inner: unknown = root.data ?? root
  const candidate = Array.isArray(inner) ? inner[0] : inner
  if (!candidate || typeof candidate !== 'object') return null
  const row = candidate as Record<string, unknown>
  return asString(row._id) || asString(row.messageId) || null
}

/**
 * Normalise one textbee received-SMS item into `InboundSmsRecord`.
 * Accepts the common field aliases so it keeps working whether the
 * payload comes from `get-received-sms` (`_id` / `sender` /
 * `message` / `receivedAt`) or the newer `/gateway/messages` shape.
 * Returns null when there's no usable sender.
 */
export function extractInboundSms(raw: unknown): InboundSmsRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const phone =
    asString(r.sender) ||
    asString(r.from) ||
    asString(r.phone) ||
    asString(r.address)
  if (!phone) return null

  const text =
    asString(r.message) || asString(r.body) || asString(r.text) || asString(r.content)

  const messageId =
    asString(r._id) ||
    asString(r.messageId) ||
    asString(r.smsId) ||
    asString(r.id) ||
    null

  const tsRaw =
    asString(r.receivedAt) ||
    asString(r.timestamp) ||
    asString(r.date) ||
    asString(r.createdAt)
  const parsed = tsRaw ? new Date(tsRaw) : null
  const receivedAt =
    parsed && !Number.isNaN(parsed.getTime())
      ? parsed.toISOString()
      : new Date().toISOString()

  return { phone, text, messageId, receivedAt }
}

/**
 * Record an SMS we just sent through textbee. Creates the contact /
 * conversation if needed and appends an agent message with
 * channel = 'sms'.
 */
export async function recordOutboundSms(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  to: string,
  message: string,
  gatewayId?: string | null,
): Promise<void> {
  const { conversationId } = await resolveConversation(db, accountId, userId, to)
  const now = new Date().toISOString()

  const { error } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'agent',
    sender_id: userId,
    content_type: 'text',
    content_text: message,
    message_id: gatewayId ?? null,
    status: 'sent',
    channel: 'sms',
  })
  if (error) {
    console.error('[sms/persist] outbound insert error:', error)
    throw error
  }

  await db
    .from('conversations')
    .update({
      last_message_text: message,
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', conversationId)
}

/**
 * Record one received SMS. De-dupes on the gateway message id (textbee
 * retries / overlapping polls) and bumps the conversation's unread
 * count. Returns true when a new row was stored.
 */
export async function recordInboundSms(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  rec: InboundSmsRecord,
): Promise<StoredInboundSms | null> {
  if (rec.messageId) {
    const { data: dup } = await db
      .from('messages')
      .select('id')
      .eq('message_id', rec.messageId)
      .maybeSingle()
    if (dup) return null
  }

  const { conversationId, contactId } = await resolveConversation(
    db,
    accountId,
    userId,
    rec.phone,
    rec.phone,
  )

  // Lead automático — best-effort, nunca romper la ingesta.
  try {
    await ensureLeadForContactRow(db, accountId, userId, contactId, 'sms')
  } catch (err) {
    console.warn('[sms/persist] ensureLead failed:', err)
  }

  const { data: conv } = await db
    .from('conversations')
    .select('unread_count')
    .eq('id', conversationId)
    .maybeSingle()

  const { error } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: rec.text || null,
    message_id: rec.messageId,
    status: 'delivered',
    channel: 'sms',
    created_at: rec.receivedAt,
  })
  if (error) {
    console.error('[sms/persist] inbound insert error:', error)
    throw error
  }

  await db
    .from('conversations')
    .update({
      last_message_text: rec.text || '[sms]',
      last_message_at: rec.receivedAt,
      unread_count: ((conv?.unread_count as number | null) || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)

  return { conversationId, contactId, text: rec.text }
}

/**
 * Persist a batch of textbee received messages. Invalid items and
 * duplicates are skipped; per-item failures are logged and skipped so
 * one bad row never aborts the rest of the batch.
 */
export async function syncInboundSms(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  list: unknown[],
): Promise<SmsSyncResult> {
  let stored = 0
  let skipped = 0
  const storedMessages: StoredInboundSms[] = []

  for (const raw of list) {
    const rec = extractInboundSms(raw)
    if (!rec) {
      skipped++
      continue
    }
    try {
      const storedMessage = await recordInboundSms(db, accountId, userId, rec)
      if (storedMessage) {
        stored++
        storedMessages.push(storedMessage)
      } else {
        skipped++
      }
    } catch (err) {
      skipped++
      console.error(
        '[sms/persist] inbound persist failed:',
        err instanceof Error ? err.message : err,
      )
    }
  }

  return { stored, skipped, storedMessages }
}
