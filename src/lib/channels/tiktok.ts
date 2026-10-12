// ============================================================
// TikTok — Login Kit (conexión de cuenta) y Business Messaging (DMs).
//
// IMPORTANTE: la mensajería de TikTok (leer/enviar DMs) NO forma parte
// del portal estándar de desarrolladores. Vive en la "Business Messaging
// API" de TikTok API for Business, que es de acceso restringido
// (partner): su documentación está tras el login del portal de Business
// y usa credenciales propias (token de la Business API), distintas del
// token de Login Kit que guarda el canal al conectar la cuenta.
//
// Por eso este módulo implementa SOLO lo que está documentado
// públicamente y se puede verificar:
//
//   - la verificación de la firma de los webhooks (`TikTok-Signature`),
//     tal como la describe la doc oficial de TikTok:
//       header:  tiktok-signature: t=<timestamp>,s=<hex>
//       hex  =  HMAC-SHA256(client_secret, `${timestamp}.${cuerpo_crudo}`)
//   - la normalización, defensiva, de los eventos y mensajes entrantes.
//
// El envío saliente (send) queda pendiente de la doc/credenciales de
// partner; `send-message.ts` devuelve un error claro en su lugar.
// ============================================================

import crypto from 'node:crypto'

/** Cabecera con la firma del webhook de TikTok. */
export const TIKTOK_SIGNATURE_HEADER = 'tiktok-signature'

/** Antigüedad máxima (segundos) aceptada en la firma (evita replay). */
export const TIKTOK_SIGNATURE_TOLERANCE_SECONDS = 300

/** Respuesta de acuse que TikTok espera (2xx bastaría, pero usamos esta). */
export const TIKTOK_WEBHOOK_ACK = { status: 200, info: 'OK' }

interface TikTokSignatureParts {
  timestamp: string
  signature: string
}

/**
 * Separa el header `TikTok-Signature` (`t=...,s=...`) en timestamp y
 * firma. Devuelve null si falta cualquiera de las dos partes.
 */
export function parseTikTokSignature(
  header: string | null,
): TikTokSignatureParts | null {
  if (!header) return null
  let timestamp: string | null = null
  let signature: string | null = null
  for (const element of header.split(',')) {
    const eq = element.indexOf('=')
    if (eq === -1) continue
    const key = element.slice(0, eq).trim()
    const value = element.slice(eq + 1).trim()
    if (key === 't') timestamp = value
    else if (key === 's') signature = value
  }
  if (!timestamp || !signature) return null
  return { timestamp, signature }
}

/**
 * Verifica la firma de un webhook de TikTok con el client_secret de la
 * app. Compara en tiempo constante y rechaza firmas caducadas (replay).
 *
 * `nowMs` y `toleranceSeconds` son inyectables para poder testear.
 */
export function verifyTikTokSignature(
  rawBody: string,
  signatureHeader: string | null,
  clientSecret: string,
  toleranceSeconds = TIKTOK_SIGNATURE_TOLERANCE_SECONDS,
  nowMs = Date.now(),
): boolean {
  if (!clientSecret) return false
  const parts = parseTikTokSignature(signatureHeader)
  if (!parts) return false

  const signedPayload = `${parts.timestamp}.${rawBody}`
  const expected = crypto
    .createHmac('sha256', clientSecret)
    .update(signedPayload, 'utf8')
    .digest('hex')

  const a = Buffer.from(parts.signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  if (!crypto.timingSafeEqual(a, b)) return false

  const ts = Number(parts.timestamp)
  if (!Number.isFinite(ts)) return false
  const skewSeconds = Math.abs(nowMs / 1000 - ts)
  return skewSeconds <= toleranceSeconds
}

// ---- Normalización de eventos entrantes -----------------------

export interface TikTokInboundMessage {
  /** open_id del usuario de TikTok que escribe (remitente/contacto). */
  senderId: string
  /** Id del mensaje asignado por TikTok (para idempotencia). */
  messageId: string | null
  text: string | null
  mediaUrl: string | null
  attachmentType: string | null
  /** epoch ms */
  timestamp: number
}

export interface TikTokWebhookEvent {
  /** p. ej. 'authorization.removed' o el tipo de evento de mensajería. */
  event: string
  /** open_id del usuario al que se refiere el evento. */
  userOpenId: string | null
  /** Presente solo si el evento es un mensaje entrante. */
  message: TikTokInboundMessage | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

/**
 * `content` puede venir como objeto o como string JSON. Lo devolvemos
 * siempre como objeto (o {} si no se puede interpretar).
 */
function normalizeContent(value: unknown): Record<string, unknown> {
  const direct = asRecord(value)
  if (direct) return direct
  if (typeof value === 'string' && value.trim()) {
    try {
      return asRecord(JSON.parse(value)) ?? {}
    } catch {
      return {}
    }
  }
  return {}
}

function normalizeEvent(item: Record<string, unknown>): TikTokWebhookEvent {
  const content = normalizeContent(item.content)

  // Campos que pueden vivir en el nivel superior o dentro de `content`.
  const event = firstString(item.event, item.event_type, item.type) ?? ''

  const senderObj =
    asRecord(item.sender) ?? asRecord(content.sender) ?? null
  const messageObj =
    asRecord(item.message) ?? asRecord(content.message) ?? null

  const userOpenId =
    firstString(
      item.user_openid,
      content.user_openid,
      content.open_id,
      senderObj?.open_id,
      senderObj?.user_id,
      item.from,
    ) ?? null

  const senderId =
    firstString(
      senderObj?.open_id,
      senderObj?.user_id,
      messageObj?.sender_id,
      userOpenId,
    ) ?? ''

  const text = firstString(
    messageObj?.text,
    messageObj?.content,
    content.text,
    item.text,
  )

  const mediaUrl = firstString(
    messageObj?.media_url,
    messageObj?.url,
    messageObj?.image_url,
    content.media_url,
  )
  const attachmentType = firstString(
    messageObj?.type,
    messageObj?.media_type,
    content.media_type,
  )

  const messageId = firstString(
    messageObj?.message_id,
    messageObj?.id,
    content.message_id,
    item.message_id,
  )

  const rawTs =
    item.create_time ?? messageObj?.create_time ?? item.timestamp ?? null
  const tsNumber = typeof rawTs === 'number' ? rawTs : Number(rawTs)
  const timestamp = Number.isFinite(tsNumber) && tsNumber > 0
    ? tsNumber < 1e12
      ? tsNumber * 1000 // segundos → ms
      : tsNumber
    : Date.now()

  const looksLikeMessage =
    event.toLowerCase().includes('message') ||
    Boolean(messageObj || text || mediaUrl)

  const message: TikTokInboundMessage | null =
    looksLikeMessage && (senderId || text || mediaUrl)
      ? {
          senderId: senderId || userOpenId || '',
          messageId,
          text,
          mediaUrl,
          attachmentType,
          timestamp,
        }
      : null

  return { event, userOpenId, message }
}

/**
 * Normaliza el cuerpo de un webhook de TikTok a una lista de eventos.
 * Tolera tanto el sobre estándar ({ event, content, user_openid, ... })
 * como variantes de la Business Messaging API. Es defensivo: ante
 * estructuras desconocidas devuelve una lista (posiblemente vacía) en
 * lugar de lanzar.
 */
export function extractTikTokEvents(payload: unknown): TikTokWebhookEvent[] {
  const items: unknown[] = Array.isArray(payload)
    ? payload
    : asRecord(payload)?.events
      ? (asRecord(payload)?.events as unknown[])
      : [payload]

  const out: TikTokWebhookEvent[] = []
  for (const item of items) {
    const record = asRecord(item)
    if (!record) continue
    const normalized = normalizeEvent(record)
    if (!normalized.event && !normalized.message) continue
    out.push(normalized)
  }
  return out
}

/**
 * Indica si un evento representa la retirada de la autorización por
 * parte del usuario (hay que desconectar el canal).
 */
export function isAuthorizationRemoved(event: TikTokWebhookEvent): boolean {
  return event.event.toLowerCase().includes('authorization.removed')
}
