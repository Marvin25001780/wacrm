import type { SupabaseClient } from '@supabase/supabase-js'

import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsappConfig } from '@/lib/whatsapp/config'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'

// ============================================================
// Runner de campañas programadas (server-side).
//
// El envío inmediato lo maneja el hook del cliente
// (`use-broadcast-sending`), que resuelve la audiencia y bombea los
// envíos desde el navegador. Una campaña *programada* no puede
// depender de que una pestaña siga abierta, así que al programarla se
// congela la lista de destinatarios (status 'pending') y este runner
// —invocado por el cron— termina los envíos con el service role.
//
// Reutiliza exactamente las mismas utilidades que la ruta
// `/api/whatsapp/broadcast` (variantes de teléfono, guardas E.164)
// para que el comportamiento sea idéntico al envío inmediato.
// ============================================================

const SEND_BATCH_SIZE = 10
/** Meta tolera bien ~10/seg; esperamos entre lotes para no reventar el límite. */
const SEND_BATCH_DELAY_MS = 1000

type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string }

interface ContactLike {
  id: string
  name?: string | null
  phone?: string | null
  email?: string | null
  company?: string | null
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Copia server-safe de `resolveVariables` del hook (pura, sin React). */
function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: ContactLike,
  customValues?: Map<string, string>,
): string[] {
  const keys = Object.keys(variables ?? {}).sort((a, b) => {
    const an = Number(a)
    const bn = Number(b)
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
    return a.localeCompare(b)
  })

  return keys.map((key) => {
    const v = variables[key]
    if (!v) return ''
    if (v.type === 'static') return v.value
    if (v.type === 'field') {
      const fieldMap: Record<string, string | null | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      }
      return fieldMap[v.value] ?? ''
    }
    return customValues?.get(v.value) ?? ''
  })
}

/** Índice contact_id → (custom_field_id → valor), en lotes. */
async function fetchCustomValueIndex(
  admin: SupabaseClient,
  contactIds: string[],
): Promise<Map<string, Map<string, string>>> {
  const index = new Map<string, Map<string, string>>()
  if (contactIds.length === 0) return index

  const PAGE = 500
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE)
    const { data } = await admin
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', slice)

    for (const row of (data ?? []) as Array<{
      contact_id: string
      custom_field_id: string
      value: string | null
    }>) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>()
      bucket.set(row.custom_field_id, row.value ?? '')
      index.set(row.contact_id, bucket)
    }
  }
  return index
}

export interface BroadcastRunResult {
  status: 'sent' | 'failed' | 'skipped'
  sent: number
  failed: number
}

/**
 * Envía una campaña programada. Toma el lock marcando el broadcast
 * como 'sending' (bajo su estado previo), procesa solo los
 * destinatarios 'pending' y fija el estado final. Idempotente frente a
 * invocaciones solapadas: la segunda no puede tomar el lock.
 */
export async function sendScheduledBroadcast(
  admin: SupabaseClient,
  broadcastId: string,
): Promise<BroadcastRunResult> {
  const { data: broadcast, error } = await admin
    .from('broadcasts')
    .select('*')
    .eq('id', broadcastId)
    .maybeSingle()
  if (error || !broadcast) throw new Error('Broadcast no encontrado')

  const b = broadcast as Record<string, unknown>
  const accountId = b.account_id as string

  // Lock: solo una ejecución puede reclamar el broadcast programado.
  const { data: claim } = await admin
    .from('broadcasts')
    .update({ status: 'sending' })
    .eq('id', broadcastId)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle()
  if (!claim) return { status: 'skipped', sent: 0, failed: 0 }

  // Línea por defecto del negocio (067).
  const { data: config } = await resolveWhatsappConfig(admin, accountId)

  if (!config) {
    await admin
      .from('broadcasts')
      .update({ status: 'failed' })
      .eq('id', broadcastId)
    return { status: 'failed', sent: 0, failed: 0 }
  }

  const accessToken = decrypt(config.access_token)
  const phoneNumberId = config.phone_number_id

  // Una plantilla homónima puede existir en cada WABA (067).
  let templateQuery = admin
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', b.template_name as string)
    .eq('language', (b.template_language as string) || 'en_US')
  if (config.waba_id) templateQuery = templateQuery.eq('waba_id', config.waba_id)
  const { data: rawTemplateRow } = await templateQuery.maybeSingle()
  const templateRow = rawTemplateRow ?? undefined

  const { data: recipients, error: recErr } = await admin
    .from('broadcast_recipients')
    .select('*, contact:contacts(*)')
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending')
  if (recErr) throw recErr

  const rows = (recipients ?? []) as Array<{
    id: string
    contact?: ContactLike | null
  }>

  if (rows.length === 0) {
    await admin
      .from('broadcasts')
      .update({ status: 'sent' })
      .eq('id', broadcastId)
    return { status: 'sent', sent: 0, failed: 0 }
  }

  const contactIds = rows
    .map((r) => r.contact?.id)
    .filter((id): id is string => Boolean(id))
  const customValueIndex = await fetchCustomValueIndex(admin, contactIds)

  const variables = (b.template_variables ?? {}) as Record<
    string,
    VariableMapping
  >
  const headerMediaUrl = (b.header_media_url as string | null)?.trim()
  const messageParams: SendTimeParams | undefined = headerMediaUrl
    ? { headerMediaUrl }
    : undefined

  let failedCount = 0

  for (let i = 0; i < rows.length; i += SEND_BATCH_SIZE) {
    const batch = rows.slice(i, i + SEND_BATCH_SIZE)

    for (const recipient of batch) {
      const phone = recipient.contact?.phone
      const sanitized = phone ? sanitizePhoneForMeta(phone) : ''

      if (!phone || !isValidE164(sanitized)) {
        failedCount++
        await admin
          .from('broadcast_recipients')
          .update({
            status: 'failed',
            error_message: phone
              ? 'Invalid phone number format'
              : 'No phone number on contact',
          })
          .eq('id', recipient.id)
        continue
      }

      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: string | null = null

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId,
            accessToken,
            to: variant,
            templateName: b.template_name as string,
            language: (b.template_language as string) || 'en_US',
            template: templateRow,
            messageParams,
            params: recipient.contact
              ? resolveVariables(
                  variables,
                  recipient.contact,
                  customValueIndex.get(recipient.contact.id),
                )
              : [],
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          lastError = message
          if (!isRecipientNotAllowedError(message)) break
        }
      }

      if (sentMessageId) {
        await admin
          .from('broadcast_recipients')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            whatsapp_message_id: sentMessageId,
            error_message: null,
          })
          .eq('id', recipient.id)
      } else {
        failedCount++
        await admin
          .from('broadcast_recipients')
          .update({
            status: 'failed',
            error_message: lastError ?? 'Unknown error',
          })
          .eq('id', recipient.id)
      }
    }

    if (i + SEND_BATCH_SIZE < rows.length) {
      await sleep(SEND_BATCH_DELAY_MS)
    }
  }

  const finalStatus = failedCount === rows.length ? 'failed' : 'sent'
  await admin
    .from('broadcasts')
    .update({ status: finalStatus })
    .eq('id', broadcastId)

  return {
    status: finalStatus,
    sent: rows.length - failedCount,
    failed: failedCount,
  }
}
