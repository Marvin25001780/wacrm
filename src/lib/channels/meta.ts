// ============================================================
// Cliente de Meta Graph API — Instagram Direct y Facebook Messenger.
//
// Instagram y Facebook NO tienen QR: se conectan con credenciales de
// Meta (token de página/System User + App Secret) y reciben los
// mensajes por un webhook de Meta (object `instagram` / `page`). Este
// módulo agrupa lo que ambas plataformas comparten:
//
//   - verificación HMAC de la firma del webhook (por App Secret),
//   - validación del token consultando la página,
//   - envío de texto y adjuntos por la Send API.
//
// Todo devuelve resultados estructurados (nunca lanza por un fallo de
// Meta) para que las rutas mapeen el error a una respuesta clara.
// ============================================================

import crypto from 'node:crypto'

export const META_GRAPH_VERSION = 'v25.0'
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`

export type MetaResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }

/**
 * Verifica la firma `X-Hub-Signature-256` de un POST de Meta usando el
 * App Secret del canal. Meta firma el cuerpo crudo con HMAC-SHA256.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!appSecret) return false
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** `type` del adjunto de cara a la Send API. */
export function metaAttachmentType(
  contentType: string,
): 'image' | 'video' | 'audio' | 'file' | null {
  switch (contentType) {
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'audio':
      return 'audio'
    case 'document':
      return 'file'
    default:
      return null
  }
}

async function graphRequest(
  path: string,
  accessToken: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<MetaResult<Record<string, unknown>>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${META_GRAPH_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    const text = await res.text().catch(() => '')
    let json: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') {
        json = parsed as Record<string, unknown>
      }
    } catch {
      // Respuesta no-JSON: se conserva el texto para el error.
    }
    if (!res.ok) {
      const errObj = (json.error ?? {}) as Record<string, unknown>
      const msg =
        (typeof errObj.message === 'string' && errObj.message) ||
        text ||
        `Meta respondió ${res.status}`
      return { ok: false, status: res.status, error: msg }
    }
    void accessToken
    return { ok: true, data: json }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : 'Error de red con Meta',
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Valida un token consultando la página. Devuelve el nombre de la
 * página para mostrarlo en la UI.
 *
 * Usa `/me` en vez de `/{page-id}`: con un token de página, `/me` es la
 * propia página y no exige `pages_read_engagement`, permiso que
 * `/{page-id}` sí pide desde Graph v23.
 */
export async function fetchPageProfile(
  pageId: string,
  accessToken: string,
): Promise<MetaResult<{ id: string; name: string | null }>> {
  const path = `/me?fields=id,name&access_token=${encodeURIComponent(
    accessToken,
  )}`
  const res = await graphRequest(path, accessToken, { method: 'GET' })
  if (!res.ok) return res
  const id = typeof res.data.id === 'string' ? res.data.id : pageId
  const name = typeof res.data.name === 'string' ? res.data.name : null
  return { ok: true, data: { id, name } }
}

/**
 * Campos que la página debe tener suscritos para que Meta entregue los
 * eventos al webhook: mensajes, postbacks, reacciones y optins.
 */
export const META_SUBSCRIBED_FIELDS = [
  'messages',
  'messaging_postbacks',
  'message_reactions',
  'messaging_optins',
] as const

/**
 * Suscribe la página al webhook de la app.
 *
 * Sin esta llamada Meta NO entrega los eventos `page`/`instagram`:
 * conectar por OAuth solo guarda el token, no activa la entrega. Es el
 * motivo típico de "conectado pero no llegan mensajes".
 */
export async function subscribePageToApp(
  pageId: string,
  accessToken: string,
): Promise<MetaResult<{ pageId: string; subscribedFields: string[] }>> {
  if (!pageId || !accessToken) {
    return { ok: false, status: 400, error: 'Falta page_id o access_token' }
  }

  const params = new URLSearchParams({
    subscribed_fields: META_SUBSCRIBED_FIELDS.join(','),
    access_token: accessToken,
  })

  const res = await graphRequest(
    `/${encodeURIComponent(pageId)}/subscribed_apps?${params.toString()}`,
    accessToken,
    { method: 'POST' },
  )
  if (!res.ok) return res

  if (res.data.success !== true) {
    return {
      ok: false,
      status: 200,
      error:
        'Meta no confirmó la suscripción de la página al webhook. Revisa que el token tenga el permiso pages_manage_metadata.',
    }
  }

  return {
    ok: true,
    data: { pageId, subscribedFields: META_SUBSCRIBED_FIELDS.slice() },
  }
}

/**
 * Lee qué campos tiene suscritos la página. Sirve para diagnosticar por
 * qué no llegan los mensajes sin tener que reconectar.
 */
export async function fetchPageSubscriptions(
  pageId: string,
  accessToken: string,
): Promise<
  MetaResult<{
    apps: { id: string; name: string; subscribedFields: string[] }[]
  }>
> {
  const params = new URLSearchParams({
    fields: 'id,name,subscribed_fields',
    access_token: accessToken,
  })

  const res = await graphRequest(
    `/${encodeURIComponent(pageId)}/subscribed_apps?${params.toString()}`,
    accessToken,
    { method: 'GET' },
  )
  if (!res.ok) return res

  const list = Array.isArray(res.data.data) ? res.data.data : []
  const apps = list.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>
    return {
      id: typeof item.id === 'string' ? item.id : '',
      name: typeof item.name === 'string' ? item.name : '',
      subscribedFields: Array.isArray(item.subscribed_fields)
        ? item.subscribed_fields.filter((f): f is string => typeof f === 'string')
        : [],
    }
  })

  return { ok: true, data: { apps } }
}

// ---- OAuth de Facebook Login (Instagram/Facebook) --------------

export interface MetaAccount {
  /** Id de la página de Facebook. */
  id: string
  name: string | null
  /** Token de página (el que usa la Send API). */
  accessToken: string
  /** Cuenta de Instagram profesional vinculada a la página (o null). */
  igUserId: string | null
  igUsername: string | null
}

/**
 * Canjea el `code` que Meta devuelve al `redirect_uri` por un token de
 * usuario. El App Secret solo vive en el servidor: por eso el canje se
 * hace aquí y nunca en el navegador.
 */
export async function exchangeMetaCodeForUserToken(args: {
  appId: string
  appSecret: string
  redirectUri: string
  code: string
}): Promise<MetaResult<{ accessToken: string }>> {
  const { appId, appSecret, redirectUri, code } = args
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  })
  const res = await graphRequest(
    '/oauth/access_token',
    '',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
    15000,
  )
  if (!res.ok) return res
  const accessToken =
    typeof res.data.access_token === 'string' ? res.data.access_token : ''
  if (!accessToken) {
    return {
      ok: false,
      status: 0,
      error: 'Meta no devolvió un token de acceso.',
    }
  }
  return { ok: true, data: { accessToken } }
}

/**
 * Lista las páginas que el usuario autorizó, con su token de página y
 * la cuenta de Instagram profesional vinculada (si la hay). Es el paso
 * que convierte un "acceso con Facebook" en credenciales concretas de
 * página para enviar y recibir.
 */
export async function fetchMetaAccounts(
  accessToken: string,
): Promise<MetaResult<MetaAccount[]>> {
  const path = `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${encodeURIComponent(
    accessToken,
  )}`
  const res = await graphRequest(path, accessToken, { method: 'GET' })
  if (!res.ok) return res

  const raw = Array.isArray(res.data.data)
    ? (res.data.data as Record<string, unknown>[])
    : []
  const accounts: MetaAccount[] = []
  for (const page of raw) {
    const id = typeof page.id === 'string' ? page.id : ''
    const token = typeof page.access_token === 'string' ? page.access_token : ''
    if (!id || !token) continue
    const igRaw =
      page.instagram_business_account &&
      typeof page.instagram_business_account === 'object'
        ? (page.instagram_business_account as Record<string, unknown>)
        : null
    accounts.push({
      id,
      name: typeof page.name === 'string' ? page.name : null,
      accessToken: token,
      igUserId: igRaw && typeof igRaw.id === 'string' ? igRaw.id : null,
      igUsername:
        igRaw && typeof igRaw.username === 'string' ? igRaw.username : null,
    })
  }
  return { ok: true, data: accounts }
}

/**
 * Nombre público del usuario (PSID/IGSID) — best-effort. Puede fallar
 * por permisos o porque la plataforma no lo expone; el llamador usa el
 * id como respaldo.
 */
export async function fetchUserName(
  userId: string,
  accessToken: string,
): Promise<string | null> {
  const path = `/${encodeURIComponent(userId)}?fields=name,username&access_token=${encodeURIComponent(
    accessToken,
  )}`
  const res = await graphRequest(path, accessToken, { method: 'GET' }, 6000)
  if (!res.ok) return null
  if (typeof res.data.name === 'string' && res.data.name) return res.data.name
  if (typeof res.data.username === 'string' && res.data.username)
    return res.data.username
  return null
}

export interface MetaSendArgs {
  pageId: string
  accessToken: string
  recipientId: string
}

/** Envía un mensaje de texto. Devuelve el message id de Meta. */
export async function sendMetaText(
  args: MetaSendArgs & { text: string },
): Promise<MetaResult<{ messageId: string }>> {
  const body = {
    messaging_type: 'RESPONSE',
    recipient: { id: args.recipientId },
    message: { text: args.text },
  }
  const res = await graphRequest(
    `/${encodeURIComponent(args.pageId)}/messages?access_token=${encodeURIComponent(
      args.accessToken,
    )}`,
    args.accessToken,
    { method: 'POST', body: JSON.stringify(body) },
  )
  if (!res.ok) return res
  const messageId =
    typeof res.data.message_id === 'string' ? res.data.message_id : ''
  return { ok: true, data: { messageId } }
}

/** Envía un adjunto por URL (imagen/vídeo/audio/archivo). */
export async function sendMetaAttachment(
  args: MetaSendArgs & {
    kind: 'image' | 'video' | 'audio' | 'file'
    url: string
  },
): Promise<MetaResult<{ messageId: string }>> {
  const body = {
    messaging_type: 'RESPONSE',
    recipient: { id: args.recipientId },
    message: {
      attachment: {
        type: args.kind,
        payload: { url: args.url, is_reusable: true },
      },
    },
  }
  const res = await graphRequest(
    `/${encodeURIComponent(args.pageId)}/messages?access_token=${encodeURIComponent(
      args.accessToken,
    )}`,
    args.accessToken,
    { method: 'POST', body: JSON.stringify(body) },
  )
  if (!res.ok) return res
  const messageId =
    typeof res.data.message_id === 'string' ? res.data.message_id : ''
  return { ok: true, data: { messageId } }
}

// ---- Parseo entrante ------------------------------------------

export interface MetaInboundMessage {
  /** PSID (Messenger) o IGSID (Instagram). */
  senderId: string
  /** Id de la página/cuenta receptora. */
  recipientId: string
  /** 'instagram' | 'facebook'. */
  channel: 'instagram' | 'facebook'
  /** Meta message id (mid). */
  messageId: string | null
  text: string | null
  attachmentUrl: string | null
  attachmentType: string | null
  /** epoch ms */
  timestamp: number
}

interface RawMessaging {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    attachments?: Array<{ type?: string; payload?: { url?: string } }>
  }
}

interface RawChange {
  field?: string
  value?: RawMessaging
}

/**
 * Normaliza el payload de un webhook de Meta a mensajes entrantes.
 * Ignora ecos (mensajes propios), receipts y eventos sin texto/adjunto.
 * Canal según `object` ('instagram' → instagram, 'page' → facebook).
 *
 * Soporta las dos formas de payload:
 *   - Messenger / Instagram vía Facebook Login → `entry[].messaging[]`
 *   - Instagram API with Instagram Login → `entry[].changes[]` con
 *     `field: "messages"` y el mensaje dentro de `value`.
 */
export function extractInboundMessages(payload: unknown): MetaInboundMessage[] {
  const root = (payload ?? {}) as { object?: string; entry?: unknown[] }
  const channel: 'instagram' | 'facebook' =
    root.object === 'instagram' ? 'instagram' : 'facebook'
  const out: MetaInboundMessage[] = []
  if (!Array.isArray(root.entry)) return out

  const push = (m: RawMessaging | undefined) => {
    if (!m || !m.message) return
    if (m.message.is_echo) return
    // Eventos de prueba del panel de Meta: no son mensajes reales.
    if (
      m.message.mid === 'random_mid' ||
      m.message.mid === 'test_message_id'
    ) {
      return
    }
    const senderId = m.sender?.id
    if (!senderId) return
    const text =
      typeof m.message.text === 'string' && m.message.text.trim()
        ? m.message.text
        : null
    const att = m.message.attachments?.[0]
    const attachmentUrl =
      typeof att?.payload?.url === 'string' ? att.payload.url : null
    const attachmentType = typeof att?.type === 'string' ? att.type : null
    if (!text && !attachmentUrl) return

    out.push({
      senderId,
      recipientId: m.recipient?.id ?? '',
      channel,
      messageId: typeof m.message.mid === 'string' ? m.message.mid : null,
      text,
      attachmentUrl,
      attachmentType,
      timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
    })
  }

  for (const entryRaw of root.entry) {
    const entry = (entryRaw ?? {}) as {
      messaging?: RawMessaging[]
      changes?: RawChange[]
    }

    if (Array.isArray(entry.messaging)) {
      for (const m of entry.messaging) push(m)
    }

    if (Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        if (!change || change.field !== 'messages') continue
        push(change.value)
      }
    }
  }

  return out
}
