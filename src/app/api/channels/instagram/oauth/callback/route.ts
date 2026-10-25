import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'

import { requireRole } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  INSTAGRAM_OAUTH_COOKIE,
  exchangeInstagramCode,
  exchangeInstagramLongLived,
  fetchInstagramProfile,
  verifyInstagramState,
} from '@/lib/channels/instagram-oauth'

/**
 * GET /api/channels/instagram/oauth/callback
 *
 * Vuelta del login directo de Instagram. Canjea el código por un token
 * corto, lo cambia por uno de larga duración (60 días) y guarda la
 * cuenta en `channel_configs` (canal `instagram`, modo
 * `instagram_login`).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams

  const err = params.get('error') || params.get('error_code')
  if (err) {
    const desc = params.get('error_description') || err
    return withClearedCookie(
      backToChannels(request, `?meta=error&reason=${safeReason(desc)}`),
    )
  }

  const code = params.get('code') ?? ''
  const state = params.get('state') ?? ''
  const cookieState = request.cookies.get(INSTAGRAM_OAUTH_COOKIE)?.value ?? ''
  const parsed = cookieState ? verifyInstagramState(cookieState) : null

  if (!code || !state || !parsed || parsed.state !== state) {
    return withClearedCookie(
      backToChannels(request, '?meta=error&reason=state'),
    )
  }

  let ctx
  try {
    ctx = await requireRole('admin')
  } catch {
    return withClearedCookie(backToChannels(request, '?meta=error&reason=auth'))
  }

  if (ctx.accountId !== parsed.accountId) {
    return withClearedCookie(
      backToChannels(request, '?meta=error&reason=account'),
    )
  }

  const appId =
    process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID ||
    process.env.INSTAGRAM_APP_ID ||
    ''
  const appSecret = process.env.INSTAGRAM_APP_SECRET || ''
  if (!appId || !appSecret) {
    return withClearedCookie(
      backToChannels(request, '?meta=error&reason=config_instagram'),
    )
  }

  const redirectUri = `${request.nextUrl.origin}/api/channels/instagram/oauth/callback`
  const shortRes = await exchangeInstagramCode({
    appId,
    appSecret,
    redirectUri,
    code,
  })
  if (!shortRes.ok) {
    console.error('[instagram-oauth] code exchange failed:', shortRes.error)
    return withClearedCookie(
      backToChannels(request, `?meta=error&reason=${safeReason(shortRes.error)}`),
    )
  }

  // Token de larga duración: el corto caduca en ~1 hora.
  const longRes = await exchangeInstagramLongLived({
    appSecret,
    accessToken: shortRes.data.accessToken,
  })
  const accessToken = longRes.ok
    ? longRes.data.accessToken
    : shortRes.data.accessToken
  if (!longRes.ok) {
    console.warn(
      '[instagram-oauth] long-lived exchange failed, using short token:',
      longRes.error,
    )
  }

  const profile = await fetchInstagramProfile(
    accessToken,
    shortRes.data.userId,
  )

  const { data: existing } = await ctx.supabase
    .from('channel_configs')
    .select('config, is_active')
    .eq('account_id', ctx.accountId)
    .eq('channel', 'instagram')
    .maybeSingle()

  const existingConfig =
    (existing?.config as Record<string, unknown> | undefined) ?? {}
  const existingVerify =
    typeof existingConfig.verify_token === 'string' &&
    existingConfig.verify_token
      ? existingConfig.verify_token
      : null

  const config: Record<string, unknown> = {
    auth_mode: 'instagram_login',
    ig_user_id: profile.igUserId || shortRes.data.userId,
    ig_username: profile.username,
    page_name: profile.name || profile.username,
    access_token: encrypt(accessToken),
    app_secret: encrypt(appSecret),
    verify_token: existingVerify ?? `nexus_${randomUUID().replace(/-/g, '')}`,
    pending_accounts: [],
    // El modo Facebook Login deja de aplicar.
    page_id: '',
  }

  const { error } = await ctx.supabase.from('channel_configs').upsert(
    {
      account_id: ctx.accountId,
      channel: 'instagram',
      config,
      is_active: true,
    },
    { onConflict: 'account_id,channel' },
  )
  if (error) {
    console.error('[instagram-oauth] upsert failed:', error)
    return withClearedCookie(
      backToChannels(request, '?meta=error&reason=save'),
    )
  }

  return withClearedCookie(
    backToChannels(request, '?meta=connected&channel=instagram'),
  )
}

function backToChannels(request: NextRequest, query: string): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = '/channels'
  url.search = query
  return NextResponse.redirect(url)
}

function withClearedCookie(response: NextResponse): NextResponse {
  response.cookies.delete(INSTAGRAM_OAUTH_COOKIE)
  return response
}

function safeReason(value: string): string {
  return encodeURIComponent(value.slice(0, 140))
}
