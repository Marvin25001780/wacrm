import crypto from 'node:crypto'

// ============================================================
// Instagram API con inicio de sesión de Instagram (Instagram Login).
//
// Alternativa al flujo de "Instagram API con Facebook Login": no
// requiere una Página de Facebook, la cuenta profesional se autoriza
// directamente contra Instagram.
//
//   authorize → https://www.instagram.com/oauth/authorize
//   token     → https://api.instagram.com/oauth/access_token
//   long-lived→ https://graph.instagram.com/access_token
//   perfil    → https://graph.instagram.com/v23.0/me
//   enviar    → https://graph.instagram.com/v23.0/{ig-user-id}/messages
//
// Los scopes son los de este producto: `instagram_business_basic` y
// `instagram_business_manage_messages`.
// ============================================================

export const INSTAGRAM_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize'
export const INSTAGRAM_OAUTH_COOKIE = 'nexus_instagram_oauth'
export const INSTAGRAM_GRAPH_BASE = 'https://graph.instagram.com/v23.0'

export const DEFAULT_INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
]

export type InstagramResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export interface InstagramOAuthState {
  state: string
  accountId: string
  userId: string
  /** epoch ms */
  exp: number
}

export interface InstagramToken {
  accessToken: string
  userId: string
  expiresIn: number
  permissions: string[]
}

export interface InstagramProfile {
  igUserId: string
  username: string
  name: string
  avatarUrl: string
}

export function resolveInstagramScopes(): string[] {
  const raw = process.env.INSTAGRAM_SCOPES?.trim()
  if (!raw) return DEFAULT_INSTAGRAM_SCOPES.slice()
  return raw
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
}

export function buildInstagramAuthUrl(args: {
  appId: string
  redirectUri: string
  state: string
  scopes: string[]
}): string {
  const url = new URL(INSTAGRAM_AUTHORIZE_URL)
  url.searchParams.set('client_id', args.appId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', args.scopes.join(','))
  url.searchParams.set('state', args.state)
  return url.toString()
}

function stateSecret(): string {
  return (
    process.env.INSTAGRAM_APP_SECRET || process.env.ENCRYPTION_KEY || ''
  )
}

export function signInstagramState(payload: InstagramOAuthState): string {
  const secret = stateSecret()
  if (!secret) {
    throw new Error(
      'Falta INSTAGRAM_APP_SECRET para firmar el estado de OAuth',
    )
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyInstagramState(token: string): InstagramOAuthState | null {
  const secret = stateSecret()
  if (!secret) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null

  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const parsed = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as InstagramOAuthState
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.accountId !== 'string' || !parsed.accountId) return null
    if (typeof parsed.userId !== 'string' || !parsed.userId) return null
    if (typeof parsed.state !== 'string' || !parsed.state) return null
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

export function randomInstagramState(): string {
  return crypto.randomBytes(24).toString('base64url')
}

/** Canjea el `code` por un token de corta duración. */
export async function exchangeInstagramCode(args: {
  appId: string
  appSecret: string
  redirectUri: string
  code: string
}): Promise<InstagramResult<InstagramToken>> {
  const body = new URLSearchParams({
    client_id: args.appId,
    client_secret: args.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: args.redirectUri,
    code: args.code,
  })

  try {
    const res = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const accessToken =
      typeof json.access_token === 'string' ? json.access_token : ''
    if (!accessToken) {
      return {
        ok: false,
        error:
          typeof json.error_message === 'string'
            ? json.error_message
            : `Instagram respondió ${res.status}`,
      }
    }
    return {
      ok: true,
      data: {
        accessToken,
        userId:
          json.user_id != null ? String(json.user_id) : '',
        expiresIn:
          typeof json.expires_in === 'number' ? json.expires_in : 3600,
        permissions: Array.isArray(json.permissions)
          ? json.permissions.filter((p): p is string => typeof p === 'string')
          : [],
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error de red con Instagram',
    }
  }
}

/** Cambia el token corto por uno de larga duración (60 días). */
export async function exchangeInstagramLongLived(args: {
  appSecret: string
  accessToken: string
}): Promise<InstagramResult<{ accessToken: string; expiresIn: number }>> {
  const url = new URL('https://graph.instagram.com/access_token')
  url.searchParams.set('grant_type', 'ig_exchange_token')
  url.searchParams.set('client_secret', args.appSecret)
  url.searchParams.set('access_token', args.accessToken)

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const accessToken =
      typeof json.access_token === 'string' ? json.access_token : ''
    if (!accessToken) {
      return {
        ok: false,
        error:
          typeof json.error_message === 'string'
            ? json.error_message
            : `Instagram respondió ${res.status}`,
      }
    }
    return {
      ok: true,
      data: {
        accessToken,
        expiresIn:
          typeof json.expires_in === 'number' ? json.expires_in : 60 * 86400,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error de red con Instagram',
    }
  }
}

/** Nombre del usuario de Instagram (IGSID) — best-effort. */
export async function fetchInstagramUserName(
  igsid: string,
  accessToken: string,
): Promise<string | null> {
  const url = new URL(`${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(igsid)}`)
  url.searchParams.set('fields', 'name,username')
  url.searchParams.set('access_token', accessToken)

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (typeof json.name === 'string' && json.name) return json.name
    if (typeof json.username === 'string' && json.username) return json.username
    return null
  } catch {
    return null
  }
}

/** Comprueba el token y devuelve la identidad de la cuenta. */
export async function fetchInstagramMe(
  accessToken: string,
  igUserId: string,
): Promise<InstagramResult<{ id: string; username: string; name: string }>> {
  if (!igUserId) {
    return { ok: false, error: 'Falta el id de la cuenta de Instagram' }
  }

  const url = new URL(
    `${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(igUserId)}`,
  )
  url.searchParams.set('fields', 'user_id,username,name')
  url.searchParams.set('access_token', accessToken)

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const errObj = (json.error ?? {}) as Record<string, unknown>
      return {
        ok: false,
        error:
          (typeof errObj.message === 'string' && errObj.message) ||
          `Instagram respondió ${res.status}`,
      }
    }
    const id =
      json.user_id != null
        ? String(json.user_id)
        : typeof json.id === 'string'
          ? json.id
          : igUserId
    return {
      ok: true,
      data: {
        id,
        username: typeof json.username === 'string' ? json.username : '',
        name: typeof json.name === 'string' ? json.name : '',
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error de red con Instagram',
    }
  }
}

/** Perfil de la cuenta autorizada — best-effort. */
export async function fetchInstagramProfile(
  accessToken: string,
  fallbackUserId: string,
): Promise<InstagramProfile> {
  const empty: InstagramProfile = {
    igUserId: fallbackUserId,
    username: '',
    name: '',
    avatarUrl: '',
  }

  try {
    const url = new URL(
      `${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(fallbackUserId)}`,
    )
    url.searchParams.set(
      'fields',
      'user_id,username,name,profile_picture_url',
    )
    url.searchParams.set('access_token', accessToken)

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return empty

    return {
      igUserId:
        json.user_id != null
          ? String(json.user_id)
          : typeof json.id === 'string'
            ? json.id
            : fallbackUserId,
      username: typeof json.username === 'string' ? json.username : '',
      name: typeof json.name === 'string' ? json.name : '',
      avatarUrl:
        typeof json.profile_picture_url === 'string'
          ? json.profile_picture_url
          : '',
    }
  } catch {
    return empty
  }
}

async function instagramRequest(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<InstagramResult<Record<string, unknown>>> {
  try {
    const res = await fetch(`${INSTAGRAM_GRAPH_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text().catch(() => '')
    let json: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') {
        json = parsed as Record<string, unknown>
      }
    } catch {
      // respuesta no-JSON
    }
    if (!res.ok) {
      const errObj = (json.error ?? {}) as Record<string, unknown>
      return {
        ok: false,
        error:
          (typeof errObj.message === 'string' && errObj.message) ||
          text ||
          `Instagram respondió ${res.status}`,
      }
    }
    return { ok: true, data: json }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error de red con Instagram',
    }
  }
}

/** Envía un DM de texto a un IGSID. */
export async function sendInstagramText(args: {
  igUserId: string
  accessToken: string
  recipientId: string
  text: string
}): Promise<InstagramResult<{ messageId: string }>> {
  const body = {
    recipient: { id: args.recipientId },
    message: { text: args.text },
  }
  const res = await instagramRequest(
    `/${encodeURIComponent(args.igUserId)}/messages`,
    args.accessToken,
    { method: 'POST', body: JSON.stringify(body) },
  )
  if (!res.ok) return res
  return {
    ok: true,
    data: {
      messageId:
        typeof res.data.message_id === 'string' ? res.data.message_id : '',
    },
  }
}

/** Envía un adjunto por URL (Instagram admite imágenes y audio). */
export async function sendInstagramAttachment(args: {
  igUserId: string
  accessToken: string
  recipientId: string
  kind: 'image' | 'video' | 'audio' | 'file'
  url: string
}): Promise<InstagramResult<{ messageId: string }>> {
  if (args.kind === 'file') {
    return {
      ok: false,
      error: 'Instagram no admite archivos como adjunto en DM.',
    }
  }
  const body = {
    recipient: { id: args.recipientId },
    message: {
      attachment: { type: args.kind, payload: { url: args.url } },
    },
  }
  const res = await instagramRequest(
    `/${encodeURIComponent(args.igUserId)}/messages`,
    args.accessToken,
    { method: 'POST', body: JSON.stringify(body) },
  )
  if (!res.ok) return res
  return {
    ok: true,
    data: {
      messageId:
        typeof res.data.message_id === 'string' ? res.data.message_id : '',
    },
  }
}
