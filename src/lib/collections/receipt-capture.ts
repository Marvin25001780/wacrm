// ============================================================
// Captura automática de comprobantes desde WhatsApp (bloque 136).
//
// Dos entradas, una sola salida: un comprobante `pending` en la
// cartera, nunca un pago aprobado.
//
//   1. `captureInboundReceipt` — el deudor manda una imagen; se baja
//      del bucket/WhatsApp, se lee con OCR y se registra.
//   2. `captureReceiptFromAgent` — el agente de IA entendió los datos
//      en texto y pidió la acción `register_receipt`.
//
// Todo es best-effort: un fallo de OCR, de descarga o de Meta se
// registra y devuelve un motivo. Jamás tumba el webhook.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  loadMediaBytes,
  loadTranscriptionConfig,
  type ConversationMediaRow,
} from '@/lib/ai/transcribe'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'
import { formatUsd } from './format'
import { fillReceiptAckText } from './payment-links-shared'
import {
  detectImageMime,
  isUsdOrUnknown,
  normalizeOcrCurrency,
  normalizeReceiptBank,
  normalizeReceiptDate,
  normalizeReceiptReference,
  parseReceiptAmount,
} from './receipt-capture-shared'
import {
  ocrReceipt,
  ReceiptOcrError,
  visionProvider,
} from './receipt-ocr'

export interface InboundReceiptInput {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  /**
   * Id de WhatsApp/Evolution del mensaje (idempotencia). Evolution no
   * siempre lo entrega; sin él se captura igual, sin protección contra
   * duplicados por mensaje.
   */
  messageId: string | null
  contentType: string
  contentText?: string | null
  mediaUrl?: string | null
  mediaType?: string | null
}

export interface ReceiptCaptureOutcome {
  captured: boolean
  /** Código estable para logs/diagnóstico. */
  reason: string
  receipt_id?: string
  debtor_name?: string
  amount?: number
  duplicate?: boolean
}

function skip(reason: string): ReceiptCaptureOutcome {
  return { captured: false, reason }
}

/** ¿La base ya tiene las columnas/RPC del bloque 136? */
function isMigrationPending(error: { code?: string } | null | undefined): boolean {
  return Boolean(
    error &&
      (error.code === '42P01' ||
        error.code === '42703' ||
        error.code === 'PGRST204' ||
        error.code === 'PGRST205'),
  )
}

// `detectImageMime` vive en las piezas puras para poder probarla sin
// cargar el cliente de Supabase ni el envío de WhatsApp.
export { detectImageMime } from './receipt-capture-shared'

interface CaptureSettings {
  migrationPending: boolean
  captureEnabled: boolean
  ackEnabled: boolean
  ackText: string | null
}

async function loadCaptureSettings(
  db: SupabaseClient,
  accountId: string,
): Promise<CaptureSettings> {
  const { data, error } = await db
    .from('collection_payment_settings')
    .select('receipt_capture_enabled, receipt_ack_enabled, receipt_ack_text')
    .eq('account_id', accountId)
    .maybeSingle()

  if (isMigrationPending(error)) {
    return {
      migrationPending: true,
      captureEnabled: false,
      ackEnabled: false,
      ackText: null,
    }
  }
  if (error) {
    console.warn('[receipt-capture] no se pudo leer la configuración:', error.message)
  }

  const row = (data ?? {}) as {
    receipt_capture_enabled?: boolean | null
    receipt_ack_enabled?: boolean | null
    receipt_ack_text?: string | null
  }

  return {
    migrationPending: false,
    // Sin fila de configuración la captura sigue activa: es una función
    // de datos, no depende de que el enlace público esté encendido.
    captureEnabled: row.receipt_capture_enabled !== false,
    ackEnabled: row.receipt_ack_enabled !== false,
    ackText: row.receipt_ack_text ?? null,
  }
}

interface ResolvedDebtor {
  id: string
  name: string
}

/**
 * Deudor del contacto: primero el vínculo explícito
 * (`collection_debtors.contact_id`), después el teléfono con la misma
 * tolerancia de la consola. Si el teléfono coincide, deja el vínculo
 * guardado para las próximas veces.
 */
export async function resolveDebtorForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<ResolvedDebtor | null> {
  const { data: direct } = await db
    .from('collection_debtors')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .limit(1)
    .maybeSingle()

  if (direct) {
    const row = direct as { id: string; name: string }
    return { id: row.id, name: row.name }
  }

  const { data: contact } = await db
    .from('contacts')
    .select('phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()

  const phone = (contact as { phone?: string | null } | null)?.phone
  if (!phone?.trim()) return null

  const { data, error } = await db.rpc('collection_debtor_for_phone', {
    p_account_id: accountId,
    p_phone: phone,
  })

  if (error) {
    if (!isMigrationPending(error)) {
      console.warn('[receipt-capture] no se pudo resolver el deudor:', error.message)
    }
    return null
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { debtor_id?: string; debtor_name?: string }
    | null
    | undefined

  if (!row?.debtor_id) return null

  // El vínculo por teléfono se guarda para que la próxima captura sea
  // una sola consulta. No pisa un contact_id ya asignado.
  await db
    .from('collection_debtors')
    .update({ contact_id: contactId })
    .eq('id', row.debtor_id)
    .eq('account_id', accountId)
    .is('contact_id', null)
    .then(({ error: linkError }) => {
      if (linkError) {
        console.warn('[receipt-capture] no se pudo vincular el contacto:', linkError.message)
      }
    })

  return {
    id: row.debtor_id,
    name: row.debtor_name?.trim() || 'Deudor',
  }
}

/**
 * Captura una imagen entrante de un deudor. No lanza.
 */
export async function captureInboundReceipt(
  input: InboundReceiptInput,
): Promise<ReceiptCaptureOutcome> {
  const { db, accountId, conversationId, contactId, messageId } = input

  try {
    if (input.contentType !== 'image' && input.contentType !== 'document') {
      return skip('not_media')
    }
    if (!input.mediaUrl) return skip('without_media')

    const declared = (input.mediaType ?? '').split(';')[0].trim().toLowerCase()
    // Evolution no entrega el MIME de la imagen; se asume JPEG y luego
    // se corrige leyendo la firma real del archivo.
    const mediaType =
      declared || (input.contentType === 'image' ? 'image/jpeg' : '')
    if (!mediaType.startsWith('image/')) {
      return skip('unsupported_mime')
    }

    const settings = await loadCaptureSettings(db, accountId)
    if (settings.migrationPending) return skip('migration_pending')
    if (!settings.captureEnabled) return skip('capture_disabled')

    const debtor = await resolveDebtorForContact(db, accountId, contactId)
    if (!debtor) return skip('debtor_not_found')

    const config = await loadTranscriptionConfig(db, accountId)
    if (!config) return skip('ai_not_configured')
    if (!visionProvider(config.provider)) return skip('provider_without_vision')

    const { data: conversation, error: convError } = await db
      .from('conversations')
      .select('account_id, channel, whatsapp_config_id, external_contact_id, assigned_agent_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (convError || !conversation) return skip('conversation_not_found')

    const conv = conversation as ConversationMediaRow & {
      assigned_agent_id?: string | null
    }

    const bytes = await loadMediaBytes(
      db,
      input.mediaUrl,
      mediaType,
      conv,
      messageId,
      'image',
    )
    if (!bytes) return skip('media_unavailable')

    const resolvedMime = detectImageMime(bytes.buffer, bytes.mimeType)
    if (!resolvedMime.startsWith('image/')) return skip('unsupported_mime')

    const ocr = await ocrReceipt({
      config,
      buffer: bytes.buffer,
      mimeType: resolvedMime,
    })

    if (!ocr.isReceipt) return skip('not_a_receipt')
    if (ocr.amount === null) return skip('amount_unreadable')
    if (!isUsdOrUnknown(ocr.currency)) return skip('currency_not_usd')

    const notes = [
      ocr.notes,
      ocr.currency ? `Moneda leída: ${ocr.currency}.` : null,
    ]
      .filter(Boolean)
      .join(' ')
      .trim()

    const { data, error } = await db.rpc('collection_receipt_capture', {
      p_account_id: accountId,
      p_debtor_id: debtor.id,
      p_conversation_id: conversationId,
      p_source_message_id: messageId,
      p_capture_source: 'ocr',
      p_amount: ocr.amount,
      p_paid_at: ocr.paidAt,
      p_reference: ocr.reference,
      p_bank: ocr.bank,
      p_file_url: input.mediaUrl,
      p_mime_type: resolvedMime,
      p_notes: notes || null,
      p_confidence: ocr.confidence,
      p_ocr_raw: ocr.raw,
    })

    if (error) {
      if (isMigrationPending(error)) return skip('migration_pending')
      console.warn('[receipt-capture] no se pudo registrar el comprobante:', error.message)
      return skip('insert_failed')
    }

    const result = (data ?? {}) as {
      ok?: boolean
      receipt_id?: string
      duplicate?: boolean
    }

    console.info(
      `[receipt-capture] OCR ${result.duplicate ? 'duplicado' : 'capturado'} deudor=${debtor.id} monto=${ocr.amount} confianza=${ocr.confidence ?? 'n/d'}`,
    )

    // Acuse al deudor. Solo si el equipo no asignó un humano al hilo:
    // una conversación tomada por una persona no debe recibir un bot.
    if (settings.ackEnabled && !conv.assigned_agent_id) {
      const ack = fillReceiptAckText(settings.ackText, {
        debtorName: debtor.name,
        amountLabel: formatUsd(ocr.amount),
        reference: ocr.reference,
      })
      if (ack) {
        await sendMessageToConversation(db, accountId, {
          conversationId,
          messageType: 'text',
          contentText: ack,
          senderType: 'bot',
        }).catch((err) => {
          console.warn(
            '[receipt-capture] el comprobante se guardó pero el acuse no salió:',
            err instanceof Error ? err.message : err,
          )
        })
      }
    }

    return {
      captured: true,
      reason: result.duplicate ? 'duplicate' : 'captured',
      receipt_id: result.receipt_id,
      debtor_name: debtor.name,
      amount: ocr.amount,
      duplicate: result.duplicate === true,
    }
  } catch (error) {
    if (error instanceof ReceiptOcrError) {
      console.warn(`[receipt-capture] OCR omitido (${error.code}): ${error.message}`)
      return skip(error.code)
    }
    console.warn(
      '[receipt-capture] fallo inesperado:',
      error instanceof Error ? error.message : error,
    )
    return skip('unexpected_error')
  }
}

export interface AgentReceiptContext {
  accountId: string
  conversationId: string
  contactId: string
  userId: string
}

export interface AgentReceiptResult {
  ok: boolean
  detail: string
  receiptId?: string
}

export interface ParsedAgentReceipt {
  amount: number
  reference: string | null
  bank: string | null
  paidAt: string | null
  notes: string | null
}

export function parseAgentReceiptValue(raw: unknown): ParsedAgentReceipt | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'Faltan los datos del comprobante.'
  }

  const fields = raw as Record<string, unknown>
  const amount = parseReceiptAmount(fields.amount)
  if (amount === null) {
    return 'El monto no es un número válido.'
  }

  const currency = normalizeOcrCurrency(fields.currency)
  if (!isUsdOrUnknown(currency)) {
    return 'El pago está en otra moneda. Regístralo manualmente con la tasa aplicada.'
  }

  return {
    amount,
    reference: normalizeReceiptReference(fields.reference),
    bank: normalizeReceiptBank(fields.bank),
    paidAt: normalizeReceiptDate(fields.paid_at),
    notes: normalizeReceiptReference(fields.notes),
  }
}

/**
 * Acción `register_receipt` del agente: crea el comprobante pendiente a
 * partir de los datos que el deudor escribió. No aprueba nada.
 */
export async function captureReceiptFromAgent(
  db: SupabaseClient,
  ctx: AgentReceiptContext,
  raw: unknown,
): Promise<AgentReceiptResult> {
  try {
    const parsed = parseAgentReceiptValue(raw)
    if (typeof parsed === 'string') {
      return { ok: false, detail: parsed }
    }

    const settings = await loadCaptureSettings(db, ctx.accountId)
    if (settings.migrationPending) {
      return { ok: false, detail: 'Falta aplicar la migración 136.' }
    }
    if (!settings.captureEnabled) {
      return { ok: false, detail: 'La captura automática está apagada.' }
    }

    const debtor = await resolveDebtorForContact(db, ctx.accountId, ctx.contactId)
    if (!debtor) {
      return { ok: false, detail: 'El contacto no está vinculado a un deudor de cobranza.' }
    }

    const { data, error } = await db.rpc('collection_receipt_capture', {
      p_account_id: ctx.accountId,
      p_debtor_id: debtor.id,
      p_conversation_id: ctx.conversationId,
      p_source_message_id: null,
      p_capture_source: 'agent',
      p_amount: parsed.amount,
      p_paid_at: parsed.paidAt,
      p_reference: parsed.reference,
      p_bank: parsed.bank,
      p_file_url: null,
      p_mime_type: null,
      p_notes: parsed.notes,
      p_confidence: null,
      p_ocr_raw: null,
    })

    if (error) {
      if (isMigrationPending(error)) {
        return { ok: false, detail: 'Falta aplicar la migración 136.' }
      }
      return { ok: false, detail: error.message }
    }

    const result = (data ?? {}) as { receipt_id?: string; duplicate?: boolean }
    return {
      ok: true,
      detail: result.duplicate
        ? `Ya existía el comprobante pendiente de ${debtor.name}.`
        : `Comprobante de ${debtor.name} registrado y pendiente de revisión.`,
      receiptId: result.receipt_id,
    }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'No se pudo registrar el comprobante.',
    }
  }
}
