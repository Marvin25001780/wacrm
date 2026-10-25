import { NextResponse, type NextRequest } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import {
  INSTAGRAM_OAUTH_COOKIE,
  buildInstagramAuthUrl,
  randomInstagramState,
  resolveInstagramScopes,
  signInstagramState,
} from '@/lib/channels/instagram-oauth'

/**
 * GET /api/channels/instagram/oauth/start
 *
 * Arranca el login directo de Instagram (Instagram API with Instagram
 * Login). No requiere Página de Facebook: la cuenta profesional se
 * autoriza contra Instagram.
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

  const appId =
    process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID ||
    process.env.INSTAGRAM_APP_ID ||
    ''
  const appSecret = process.env.INSTAGRAM_APP_SECRET || ''

  if (!appId || !appSecret) {
    return backToChannels(request, '?meta=error&reason=config_instagram')
  }

  const state = randomInstagramState()
  const signed = signInstagramState({
    state,
    accountId,
    userId,
    exp: Date.now() + 10 * 60 * 1000,
  })

  const redirectUri = `${request.nextUrl.origin}/api/channels/instagram/oauth/callback`
  const authUrl = buildInstagramAuthUrl({
    appId,
    redirectUri,
    state,
    scopes: resolveInstagramScopes(),
  })

  const response = NextResponse.redirect(authUrl)
  response.cookies.set(INSTAGRAM_OAUTH_COOKIE, signed, {
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
