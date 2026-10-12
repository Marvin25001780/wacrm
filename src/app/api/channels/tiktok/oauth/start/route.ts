import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import {
  buildTikTokAuthUrl,
  randomTikTokState,
  resolveTikTokScopes,
  signTikTokState,
  TIKTOK_OAUTH_COOKIE,
} from '@/lib/channels/tiktok-oauth'

/**
 * GET /api/channels/tiktok/oauth/start
 *
 * Arranca el OAuth de TikTok (Login Kit): firma un `state` (cookie
 * HttpOnly) y redirige al diálogo de autorización de TikTok. El usuario
 * autoriza y TikTok vuelve a `/api/channels/tiktok/oauth/callback`. El
 * `redirect_uri` se deriva del host de la petición y debe estar
 * registrado en tu app de TikTok for Developers.
 *
 * No devuelve JSON: siempre redirige (a TikTok o de vuelta a /channels
 * con un motivo de error).
 */
export async function GET(request: NextRequest) {
  let accountId: string
  let userId: string
  try {
    const ctx = await requireRole('admin')
    accountId = ctx.accountId
    userId = ctx.userId
  } catch {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.search = ''
    return NextResponse.redirect(login)
  }

  const clientKey =
    process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY ||
    process.env.TIKTOK_CLIENT_KEY ||
    ''
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || ''
  if (!clientKey || !clientSecret) {
    return backToChannels(request, '?tiktok=error&reason=config')
  }

  const state = randomTikTokState()
  const signed = signTikTokState({
    state,
    accountId,
    userId,
    exp: Date.now() + 10 * 60 * 1000,
  })

  const redirectUri = `${request.nextUrl.origin}/api/channels/tiktok/oauth/callback`
  const authUrl = buildTikTokAuthUrl({
    clientKey,
    redirectUri,
    state,
    scopes: resolveTikTokScopes(),
  })

  const response = NextResponse.redirect(authUrl)
  response.cookies.set(TIKTOK_OAUTH_COOKIE, signed, {
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
