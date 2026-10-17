import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireRole } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  exchangeMetaCodeForUserToken,
  fetchMetaAccounts,
} from '@/lib/channels/meta'
import {
  META_OAUTH_COOKIE,
  verifyMetaOAuthState,
} from '@/lib/channels/meta-oauth'

/**
 * GET /api/channels/meta/oauth/callback
 *
 * Vuelta del diálogo de Facebook Login. Verifica el `state` contra la
 * cookie firmada, canjea el `code` por un token de usuario, lista las
 * páginas autorizadas y guarda las credenciales:
 *
 *   - 1 cuenta  → se conecta directamente.
 *   - Varias    → se guardan como pendientes y la UI pide elegir.
 *
 * Nunca devuelve JSON: redirige a /channels con `?meta=...` para que la
 * página muestre el aviso correspondiente.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams

  // Meta puede devolver `error` cuando el usuario cancela o deniega.
  const err = params.get('error')
  if (err) {
    const desc = params.get('error_description') || err
    return withClearedCookie(
      backToChannels(request, `?meta=error&reason=${safeReason(desc)}`),
    )
  }

  const code = params.get('code') ?? ''
  const state = params.get('state') ?? ''
  const cookieState = request.cookies.get(META_OAUTH_COOKIE)?.value ?? ''
  const parsed = cookieState ? verifyMetaOAuthState(cookieState) : null

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
    process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || ''
  const appSecret = process.env.META_APP_SECRET || ''
  if (!appId || !appSecret) {
    return withClearedCookie(
      backToChannels(request, '?meta=error&reason=config'),
    )
  }

  const redirectUri = `${request.nextUrl.origin}/api/channels/meta/oauth/callback`
  const tokenRes = await exchangeMetaCodeForUserToken({
    appId,
    appSecret,
    redirectUri,
    code,
  })
  if (!tokenRes.ok) {
    console.error('[meta-oauth] code exchange failed:', tokenRes.error)
    return withClearedCookie(
      backToChannels(request, `?meta=error&reason=${safeReason(tokenRes.error)}`),
    )
  }

  const accountsRes = await fetchMetaAccounts(tokenRes.data.accessToken)
  if (!accountsRes.ok) {
    console.error('[meta-oauth] fetch accounts failed:', accountsRes.error)
    return withClearedCookie(
      backToChannels(
        request,
        `?meta=error&reason=${safeReason(accountsRes.error)}`,
      ),
    )
  }

  // Instagram exige una cuenta profesional vinculada a la página;
  // Facebook admite cualquier página con token.
  const candidates = accountsRes.data.filter((a) =>
    parsed.channel === 'instagram' ? Boolean(a.igUserId) : true,
  )
  if (candidates.length === 0) {
    return withClearedCookie(
      backToChannels(request, '?meta=error&reason=no_accounts'),
    )
  }

  // Config existente: conservamos los campos activos al re-conectar.
  const { data: existing } = await ctx.supabase
    .from('channel_configs')
    .select('config, is_active')
    .eq('account_id', ctx.accountId)
    .eq('channel', parsed.channel)
    .maybeSingle()
  const existingConfig =
    (existing?.config as Record<string, unknown> | undefined) ?? {}
  const existingVerify =
    typeof existingConfig.verify_token === 'string' && existingConfig.verify_token
      ? existingConfig.verify_token
      : null

  if (candidates.length === 1) {
    const only = candidates[0]
    const config: Record<string, unknown> = {
      ...existingConfig,
      page_id: only.id,
      access_token: encrypt(only.accessToken),
      app_secret: encrypt(appSecret),
      verify_token: existingVerify ?? `nexus_${randomUUID().replace(/-/g, '')}`,
      pending_accounts: [],
    }
    const { error } = await ctx.supabase.from('channel_configs').upsert(
      {
        account_id: ctx.accountId,
        channel: parsed.channel,
        config,
        is_active: true,
      },
      { onConflict: 'account_id,channel' },
    )
    if (error) {
      console.error('[meta-oauth] upsert failed:', error)
      return withClearedCookie(
        backToChannels(request, '?meta=error&reason=save'),
      )
    }
    return withClearedCookie(
      backToChannels(request, `?meta=connected&channel=${parsed.channel}`),
    )
  }

  // Varias cuentas: guardamos las opciones (con el token cifrado) y
  // dejamos que el usuario elija. No tocamos la conexión activa.
  const pending = candidates.slice(0, 25).map((a) => ({
    page_id: a.id,
    name: a.name ?? '',
    username: a.igUsername ?? '',
    access_token: encrypt(a.accessToken),
  }))
  const config: Record<string, unknown> = {
    ...existingConfig,
    pending_accounts: pending,
  }
  const { error } = await ctx.supabase.from('channel_configs').upsert(
    {
      account_id: ctx.accountId,
      channel: parsed.channel,
      config,
      is_active: Boolean(existing?.is_active),
    },
    { onConflict: 'account_id,channel' },
  )
  if (error) {
    console.error('[meta-oauth] pending upsert failed:', error)
    return withClearedCookie(backToChannels(request, '?meta=error&reason=save'))
  }
  return withClearedCookie(
    backToChannels(request, `?meta=choose&channel=${parsed.channel}`),
  )
}

function backToChannels(request: NextRequest, query: string): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = '/channels'
  url.search = query
  return NextResponse.redirect(url)
}

function withClearedCookie(response: NextResponse): NextResponse {
  response.cookies.delete(META_OAUTH_COOKIE)
  return response
}

/** Recorta el motivo para que quepa en la URL. */
function safeReason(value: string): string {
  return encodeURIComponent(value.slice(0, 140))
}
