import crypto from 'node:crypto'

// ============================================================
// OAuth de Facebook Login para Instagram Direct y Facebook
// Messenger (flujo de redirección, estilo Kommo).
//
// El usuario pulsa "Continuar con Facebook" y el navegador sale hacia
// el diálogo de Meta con `client_id` + `config_id` (o `scope`) y un
// `state` firmado. Meta vuelve al callback con `?code&state`; el
// servidor canjea el code por un token de usuario y resuelve las
// páginas/cuentas autorizadas. El App Secret nunca toca el navegador.
//
// El `state` se firma con HMAC-SHA256 (META_APP_SECRET) y viaja además
// en una cookie HttpOnly: así se comprueba que el callback pertenece a
// ESTE navegador y a ESTA cuenta, evitando CSRF y cruces de cuentas.
// ============================================================

export const META_OAUTH_COOKIE = 'nexus_meta_oauth'

/**
 * Permisos clásicos del diálogo de Facebook Login. Se usan cuando no
 * hay un Configuration ID de Facebook Login for Business: la app debe
 * tener el producto "Facebook Login" y estos permisos solicitados.
 */
export const META_OAUTH_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'instagram_basic',
  'instagram_manage_messages',
  'business_management',
]

export type MetaOAuthChannel = 'instagram' | 'facebook'

export interface MetaOAuthState {
  /** Nonce anti-CSRF que también se manda a Meta como `state`. */
  state: string
  channel: MetaOAuthChannel
  accountId: string
  userId: string
  /** epoch ms — caducidad del permiso (10 min por defecto). */
  exp: number
}

/** Construye la URL del diálogo de Facebook Login. */
export function buildMetaOAuthUrl(args: {
  appId: string
  configId?: string | null
  redirectUri: string
  state: string
}): string {
  const url = new URL('https://www.facebook.com/v25.0/dialog/oauth')
  url.searchParams.set('client_id', args.appId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', args.state)
  const configId = args.configId?.trim()
  if (configId) {
    url.searchParams.set('config_id', configId)
  } else {
    url.searchParams.set('scope', META_OAUTH_SCOPES.join(','))
  }
  return url.toString()
}

function stateSecret(): string {
  return process.env.META_APP_SECRET || process.env.ENCRYPTION_KEY || ''
}

/** Firma el payload de OAuth: `<base64url>.<hmac>`. */
export function signMetaOAuthState(payload: MetaOAuthState): string {
  const secret = stateSecret()
  if (!secret) {
    throw new Error('Falta META_APP_SECRET para firmar el estado de OAuth')
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url')
  return `${body}.${sig}`
}

/** Verifica firma + caducidad. Devuelve null si algo no cuadra. */
export function verifyMetaOAuthState(token: string): MetaOAuthState | null {
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
    ) as MetaOAuthState
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.channel !== 'instagram' && parsed.channel !== 'facebook') {
      return null
    }
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
export function randomMetaOAuthState(): string {
  return crypto.randomBytes(24).toString('base64url')
}
