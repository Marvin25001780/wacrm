import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import {
  buildMetaOAuthUrl,
  randomMetaOAuthState,
  signMetaOAuthState,
  META_OAUTH_COOKIE,
  type MetaOAuthChannel,
} from '@/lib/channels/meta-oauth'

/**
 * GET /api/channels/meta/oauth/start?channel=instagram|facebook
 *
 * Arranca el OAuth de Facebook Login: firma un `state` (cookie HttpOnly)
 * y redirige al diálogo de Meta. El usuario autoriza y Meta vuelve a
 * `/api/channels/meta/oauth/callback`. El `redirect_uri` se deriva del
 * host de la petición, que debe estar registrado como URI de
 * redirección válido en la app de Meta.
 *
 * No devuelve JSON: siempre redirige (al diálogo de Meta o de vuelta a
 * /channels con un motivo de error).
 */
export async function GET(request: NextRequest) {
  const channelParam = request.nextUrl.searchParams.get('channel')
  const channel: MetaOAuthChannel | null =
    channelParam === 'instagram' || channelParam === 'facebook'
      ? channelParam
      : null
  if (!channel) {
    return backToChannels(request, '?meta=error&reason=channel')
  }

  let accountId: string
  let userId: string
  try {
    const ctx = await requireRole('admin')
    accountId = ctx.accountId
    userId = ctx.userId
  } catch {
    // Sin sesión de admin: al login (el middleware no protege /api/channels).
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.search = ''
    return NextResponse.redirect(login)
  }

  const appId =
    process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || ''
  if (!appId) {
    return backToChannels(request, '?meta=error&reason=config')
  }

  const state = randomMetaOAuthState()
  const signed = signMetaOAuthState({
    state,
    channel,
    accountId,
    userId,
    exp: Date.now() + 10 * 60 * 1000,
  })

  const redirectUri = `${request.nextUrl.origin}/api/channels/meta/oauth/callback`
  // Instagram puede usar un Configuration ID de Facebook Login for
  // Business; Facebook Messenger usa el flujo clásico de scopes porque
  // un único config_id de Instagram no sirve para Messenger.
  const configId =
    channel === 'instagram' ? process.env.NEXT_PUBLIC_META_IG_CONFIG_ID : undefined
  const authUrl = buildMetaOAuthUrl({
    appId,
    configId,
    redirectUri,
    state,
  })

  const response = NextResponse.redirect(authUrl)
  response.cookies.set(META_OAUTH_COOKIE, signed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: 10 * 60,
  })
  return response
}

function backToChannels(request: NextRequest, query: string): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = '/channels'
  url.search = query
  return NextResponse.redirect(url)
}
