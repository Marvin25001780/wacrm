import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  exchangeTikTokCode,
  fetchTikTokUser,
  verifyTikTokState,
  TIKTOK_OAUTH_COOKIE,
} from '@/lib/channels/tiktok-oauth'

/**
 * GET /api/channels/tiktok/oauth/callback
 *
 * Vuelta del diálogo de TikTok. Verifica el `state` contra la cookie
 * firmada, canjea el `code` por un token de usuario y guarda las
 * credenciales en `channel_configs` (canal `tiktok`). El nombre/usuario
 * se toma del endpoint de user info como best-effort: si falla, la
 * conexión se guarda igualmente.
 *
 * Nunca devuelve JSON: redirige a /channels con `?tiktok=...` para que
 * la página muestre el aviso correspondiente.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams

  // TikTok devuelve `error`/`error_description` si el usuario cancela.
  const err = params.get('error') || params.get('error_code')
  if (err) {
    const desc = params.get('error_description') || err
    return withClearedCookie(
      backToChannels(request, `?tiktok=error&reason=${safeReason(desc)}`),
    )
  }

  const code = params.get('code') ?? ''
  const state = params.get('state') ?? ''
  const cookieState = request.cookies.get(TIKTOK_OAUTH_COOKIE)?.value ?? ''
  const parsed = cookieState ? verifyTikTokState(cookieState) : null

  if (!code || !state || !parsed || parsed.state !== state) {
    return withClearedCookie(
      backToChannels(request, '?tiktok=error&reason=state'),
    )
  }

  let ctx
  try {
    ctx = await requireRole('admin')
  } catch {
    return withClearedCookie(backToChannels(request, '?tiktok=error&reason=auth'))
  }

  if (ctx.accountId !== parsed.accountId) {
    return withClearedCookie(
      backToChannels(request, '?tiktok=error&reason=account'),
    )
  }

  const clientKey =
    process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY ||
    process.env.TIKTOK_CLIENT_KEY ||
    ''
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || ''
  if (!clientKey || !clientSecret) {
    return withClearedCookie(
      backToChannels(request, '?tiktok=error&reason=config'),
    )
  }

  const redirectUri = `${request.nextUrl.origin}/api/channels/tiktok/oauth/callback`
  const tokenRes = await exchangeTikTokCode({
    clientKey,
    clientSecret,
    code,
    redirectUri,
  })
  if (!tokenRes.ok) {
    console.error('[tiktok-oauth] token exchange failed:', tokenRes.error)
    return withClearedCookie(
      backToChannels(request, `?tiktok=error&reason=${safeReason(tokenRes.error)}`),
    )
  }

  // Nombre/usuario — best-effort (no bloquea la conexión).
  const userRes = await fetchTikTokUser(tokenRes.data.accessToken)
  const user = userRes.ok
    ? userRes.data
    : { openId: '', displayName: '', username: '', avatarUrl: '' }

  const config: Record<string, unknown> = {
    open_id: user.openId || tokenRes.data.openId,
    display_name: user.displayName,
    username: user.username,
    scope: tokenRes.data.scope,
    access_token: encrypt(tokenRes.data.accessToken),
    ...(tokenRes.data.refreshToken
      ? { refresh_token: encrypt(tokenRes.data.refreshToken) }
      : {}),
  }

  const { error } = await ctx.supabase.from('channel_configs').upsert(
    {
      account_id: ctx.accountId,
      channel: 'tiktok',
      config,
      is_active: true,
    },
    { onConflict: 'account_id,channel' },
  )
  if (error) {
    console.error('[tiktok-oauth] upsert failed:', error)
    return withClearedCookie(backToChannels(request, '?tiktok=error&reason=save'))
  }

  return withClearedCookie(backToChannels(request, '?tiktok=connected'))
}

function backToChannels(request: NextRequest, query: string): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = '/channels'
  url.search = query
  return NextResponse.redirect(url)
}

function withClearedCookie(response: NextResponse): NextResponse {
  response.cookies.delete(TIKTOK_OAUTH_COOKIE)
  return response
}

/** Recorta el motivo para que quepa en la URL. */
function safeReason(value: string): string {
  return encodeURIComponent(value.slice(0, 140))
}
