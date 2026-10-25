import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { isChannelType } from '@/lib/channels/config'
import { fetchPageProfile, fetchPageSubscriptions } from '@/lib/channels/meta'
import { fetchInstagramMe } from '@/lib/channels/instagram-oauth'

/**
 * POST /api/channels/[channel]/test
 * Comprueba la conexión con el proveedor usando la config guardada.
 * Requiere admin+. Devuelve `{ ok, status }` para mostrarlo en el panel.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ channel: string }> },
) {
  try {
    const { channel } = await context.params
    if (!isChannelType(channel)) {
      return NextResponse.json({ error: 'Canal desconocido' }, { status: 400 })
    }

    const ctx = await requireRole('admin')
    const limited = checkRateLimit(
      `channels-test:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limited.success) return rateLimitResponse(limited)

    const { data: row } = await ctx.supabase
      .from('channel_configs')
      .select('config')
      .eq('account_id', ctx.accountId)
      .eq('channel', channel)
      .maybeSingle()

    if (!row) {
      return NextResponse.json({ error: 'Canal no configurado' }, { status: 404 })
    }
    const config = (row.config ?? {}) as Record<string, unknown>

    // Canales de Meta (Instagram / Facebook): validar el token contra
    // la Graph API. Leer el nombre de la página exige
    // `pages_read_engagement`, que no siempre está concedido, así que
    // la prueba se apoya también en `subscribed_apps`
    // (`pages_manage_metadata`), que es lo que determina si llegan los
    // mensajes.
    if (channel === 'instagram' || channel === 'facebook') {
      const pageId = String(config.page_id ?? '')
      const token =
        typeof config.access_token === 'string' ? decrypt(config.access_token) : ''
      const authMode =
        typeof config.auth_mode === 'string' ? config.auth_mode : ''

      // Login directo de Instagram: se valida contra graph.instagram.com.
      if (channel === 'instagram' && authMode === 'instagram_login') {
        if (!token) {
          return NextResponse.json(
            { ok: false, status: null, error: 'Faltan credenciales' },
            { status: 400 },
          )
        }
        const me = await fetchInstagramMe(token)
        return NextResponse.json({
          ok: me.ok,
          status: me.ok ? 200 : null,
          error: me.ok ? undefined : me.error,
          page_name: me.ok ? me.data.username || me.data.name : undefined,
        })
      }

      if (!pageId || !token) {
        return NextResponse.json(
          { ok: false, status: null, error: 'Faltan credenciales' },
          { status: 400 },
        )
      }

      const [profile, subs] = await Promise.all([
        fetchPageProfile(pageId, token),
        fetchPageSubscriptions(pageId, token),
      ])

      const ok = profile.ok || subs.ok
      const storedName =
        typeof config.page_name === 'string' ? config.page_name : undefined

      return NextResponse.json({
        ok,
        status: ok ? 200 : profile.ok ? subs.status : profile.status,
        error: ok ? undefined : profile.error,
        page_name: profile.ok ? profile.data.name : storedName,
        subscribed_fields: subs.ok
          ? [...new Set(subs.data.apps.flatMap((app) => app.subscribedFields))]
          : undefined,
        warning:
          ok && !profile.ok
            ? 'Token válido. Meta no permite leer el nombre de la página sin pages_read_engagement.'
            : undefined,
      })
    }

    const baseUrl = String(config.base_url ?? '').replace(/\/$/, '')
    if (!baseUrl) {
      return NextResponse.json({ error: 'Falta la URL base' }, { status: 400 })
    }

    let url: string
    let headers: Record<string, string> = {}

    if (channel === 'evolution') {
      const instance = String(config.instance ?? '')
      const apiKey = typeof config.api_key === 'string' ? decrypt(config.api_key) : ''
      url = `${baseUrl}/instance/connectionState/${encodeURIComponent(instance)}`
      headers = { apikey: apiKey }
    } else {
      const accountId = String(config.account_id ?? '')
      const token = typeof config.api_token === 'string' ? decrypt(config.api_token) : ''
      url = `${baseUrl}/api/v1/accounts/${encodeURIComponent(accountId)}`
      headers = { api_access_token: token }
    }

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000),
      })
      return NextResponse.json({ ok: res.ok, status: res.status })
    } catch (err) {
      return NextResponse.json({
        ok: false,
        status: null,
        error: err instanceof Error ? err.message : 'Error de red',
      })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
