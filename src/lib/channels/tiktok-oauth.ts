import crypto from 'node:crypto'

// ============================================================
// OAuth de TikTok (Login Kit) para el canal TikTok.
//
// Mismo patrón que el OAuth de Meta: el navegador sale al diálogo de
// TikTok con `client_key` + `scope` + `redirect_uri` + `state`; TikTok
// vuelve al callback con `?code&state`; el servidor canjea el code por
// un token (el client_secret nunca toca el navegador) y guarda las
// credenciales.
//
//   authorize → https://www.tiktok.com/v2/auth/authorize/
//   token     → https://open.tiktokapis.com/v2/oauth/token/
//   userinfo  → https://open.tiktokapis.com/v2/user/info/
//
// El `state` se firma con HMAC-SHA256 (TIKTOK_CLIENT_SECRET) y viaja en
// una cookie HttpOnly: así se comprueba que el callback pertenece a
// ESTE navegador y a ESTA cuenta (anti-CSRF).
// ============================================================

export const TIKTOK_OAUTH_COOKIE = 'nexus_tiktok_oauth'
export const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const TIKTOK_USERINFO_URL =
  'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username'

/**
 * Scopes por defecto (login + mensajería de negocio). Los scopes de
 * mensajería (`message.list.*`) exigen cuenta de empresa y acceso
 * aprobado por TikTok; si tu app no los tiene, TikTok rechazará la
 * autorización. Se pueden ajustar con la variable TIKTOK_SCOPES
 * (lista separada por comas).
 */
export const DEFAULT_TIKTOK_SCOPES = [
  'user.info.basic',
  'user.account.type',
  'user.info.username',
  'message.list.read',
  'message.list.send',
  'message.list.manage',
  'video.list',
  'comment.list',
  'comment.list.manage',
]

export interface TikTokOAuthState {
  /** Nonce anti-CSRF que también se manda a TikTok como `state`. */
  state: string
  accountId: string
  userId: string
  /** epoch ms — caducidad del permiso. */
  exp: number
}

export type TikTokResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export interface TikTokToken {
  accessToken: string
  refreshToken: string
  openId: string
  scope: string
  expiresIn: number
}

export interface TikTokUser {
  openId: string
  displayName: string
  username: string
  avatarUrl: string
}

/** Scopes efectivos: TIKTOK_SCOPES o el conjunto por defecto. */
export function resolveTikTokScopes(): string[] {
  const raw = process.env.TIKTOK_SCOPES?.trim()
  if (!raw) return DEFAULT_TIKTOK_SCOPES.slice()
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Construye la URL del diálogo de autorización de TikTok. */
export function buildTikTokAuthUrl(args: {
  clientKey: string
  redirectUri: string
  state: string
  scopes: string[]
}): string {
  const url = new URL(TIKTOK_AUTHORIZE_URL)
  url.searchParams.set('client_key', args.clientKey)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', args.scopes.join(','))
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('state', args.state)
  return url.toString()
}

function stateSecret(): string {
  return process.env.TIKTOK_CLIENT_SECRET || process.env.ENCRYPTION_KEY || ''
}

/** Firma el payload de OAuth: `<base64url>.<hmac>`. */
export function signTikTokState(payload: TikTokOAuthState): string {
  const secret = stateSecret()
  if (!secret) {
    throw new Error('Falta TIKTOK_CLIENT_SECRET para firmar el estado de OAuth')
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url')
  return `${body}.${sig}`
}

/** Verifica firma + caducidad. Devuelve null si algo no cuadra. */
export function verifyTikTokState(token: string): TikTokOAuthState | null {
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
    ) as TikTokOAuthState
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

/** Nonce aleatorio para el `state`. */
export function randomTikTokState(): string {
  return crypto.randomBytes(24).toString('base64url')
}

/** Extrae el mensaje de error de distintas formas de respuesta de TikTok. */
function tiktokError(json: Record<string, unknown>): string {
  const err = json.error
  if (typeof err === 'string' && err) {
    const desc =
      typeof json.error_description === 'string' ? json.error_description : ''
    return desc ? `${err}: ${desc}` : err
  }
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const code = typeof obj.code === 'string' ? obj.code : ''
    const message = typeof obj.message === 'string' ? obj.message : ''
    if (code && code !== 'ok') return message ? `${code}: ${message}` : code
    if (message) return message
  }
  return ''
}

async function postForm(
  url: string,
  body: URLSearchParams,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    // Respuesta no-JSON: se reporta como error abajo.
  }
  return { status: res.status, json }
}

/** Canjea el `code` por un token. El client_secret solo vive aquí. */
export async function exchangeTikTokCode(args: {
  clientKey: string
  clientSecret: string
  code: string
  redirectUri: string
}): Promise<TikTokResult<TikTokToken>> {
  const body = new URLSearchParams({
    client_key: args.clientKey,
    client_secret: args.clientSecret,
    code: args.code,
    grant_type: 'authorization_code',
    redirect_uri: args.redirectUri,
  })
  try {
    const { status, json } = await postForm(TIKTOK_TOKEN_URL, body)
    const accessToken =
      typeof json.access_token === 'string' ? json.access_token : ''
    if (!accessToken) {
      return {
        ok: false,
        error: tiktokError(json) || `TikTok respondió ${status}`,
      }
    }
    return {
      ok: true,
      data: {
        accessToken,
        refreshToken:
          typeof json.refresh_token === 'string' ? json.refresh_token : '',
        openId: typeof json.open_id === 'string' ? json.open_id : '',
        scope: typeof json.scope === 'string' ? json.scope : '',
        expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 0,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error de red con TikTok',
    }
  }
}

/** Nombre/usuario de la cuenta autorizada — best-effort. */
export async function fetchTikTokUser(
  accessToken: string,
): Promise<TikTokResult<TikTokUser>> {
  try {
    const res = await fetch(TIKTOK_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      // sin JSON
    }
    if (!res.ok) {
      return { ok: false, error: tiktokError(json) || `TikTok respondió ${res.status}` }
    }
    const data = (json.data ?? {}) as Record<string, unknown>
    const user = (data.user ?? {}) as Record<string, unknown>
    return {
      ok: true,
      data: {
        openId: typeof user.open_id === 'string' ? user.open_id : '',
        displayName: typeof user.display_name === 'string' ? user.display_name : '',
        username: typeof user.username === 'string' ? user.username : '',
        avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : '',
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error de red con TikTok',
    }
  }
}
