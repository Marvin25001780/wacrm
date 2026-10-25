import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { mergeChannelConfig, serializeChannelConfig } from '@/lib/channels/config'
import { fetchPageProfile, subscribePageToApp } from '@/lib/channels/meta'

/**
 * POST /api/channels/meta/connect
 *
 * Conecta un canal de Meta (Instagram Direct o Facebook Messenger) por
 * token. Valida el token consultando la página en la Graph API y, si
 * responde, guarda la config cifrada y marca el canal como activo.
 *
 * Body: { channel, page_id, access_token?, app_secret?, verify_token? }
 * - `access_token`/`app_secret` son write-only (si se omiten, se
 *   conservan los ya guardados, para reconectar sin re-teclear).
 * - `verify_token` se auto-genera si no llega.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limited = checkRateLimit(
      `channels-meta-connect:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    const channel = body.channel
    if (channel !== 'instagram' && channel !== 'facebook') {
      return NextResponse.json(
        { error: 'Canal desconocido (se espera instagram o facebook)' },
        { status: 400 },
      )
    }

    const pageId = typeof body.page_id === 'string' ? body.page_id.trim() : ''
    if (!pageId) {
      return NextResponse.json(
        { error: 'El Page ID es obligatorio' },
        { status: 400 },
      )
    }

    const incomingToken =
      typeof body.access_token === 'string' ? body.access_token.trim() : ''
    const incomingSecret =
      typeof body.app_secret === 'string' ? body.app_secret.trim() : ''
    let verifyToken =
      typeof body.verify_token === 'string' ? body.verify_token.trim() : ''

    // Config existente (para conservar secretos al reconectar).
    const { data: existing } = await ctx.supabase
      .from('channel_configs')
      .select('config')
      .eq('account_id', ctx.accountId)
      .eq('channel', channel)
      .maybeSingle()
    const existingConfig =
      (existing?.config as Record<string, unknown> | undefined) ?? {}

    // Token efectivo para validar: el nuevo o el guardado (descifrado).
    let effectiveToken = incomingToken
    if (!effectiveToken && typeof existingConfig.access_token === 'string') {
      try {
        effectiveToken = decrypt(existingConfig.access_token)
      } catch {
        effectiveToken = ''
      }
    }
    if (!effectiveToken) {
      return NextResponse.json(
        { error: 'El token de acceso es obligatorio' },
        { status: 400 },
      )
    }

    // Validación real contra Meta: consulta la página con el token.
    const profile = await fetchPageProfile(pageId, effectiveToken)
    if (!profile.ok) {
      return NextResponse.json(
        {
          error: `Meta rechazó las credenciales: ${profile.error}`,
          status: profile.status,
        },
        { status: 400 },
      )
    }

    if (!verifyToken) {
      verifyToken = `nexus_${randomUUID().replace(/-/g, '')}`
    }

    const merged = mergeChannelConfig(
      channel,
      {
        page_id: pageId,
        page_name: profile.data.name ?? '',
        verify_token: verifyToken,
        ...(incomingToken ? { access_token: incomingToken } : {}),
        ...(incomingSecret ? { app_secret: incomingSecret } : {}),
      },
      existingConfig,
    )
    if (!merged.ok) {
      return NextResponse.json({ error: merged.error }, { status: 400 })
    }

    const { data, error } = await ctx.supabase
      .from('channel_configs')
      .upsert(
        {
          account_id: ctx.accountId,
          channel,
          config: merged.config,
          is_active: true,
        },
        { onConflict: 'account_id,channel' },
      )
      .select('*')
      .single()

    if (error || !data) throw error ?? new Error('upsert failed')

    // Sin suscribir la página, Meta no entrega los mensajes al webhook.
    let subscribed = true
    let subscribeError = ''
    try {
      const result = await subscribePageToApp(pageId, effectiveToken)
      if (!result.ok) {
        subscribed = false
        subscribeError = result.error
        console.error('[meta-connect] page subscription failed:', result.error)
      }
    } catch (err) {
      subscribed = false
      subscribeError =
        err instanceof Error ? err.message : 'No se pudo suscribir la página'
      console.error('[meta-connect] page subscription threw:', err)
    }

    return NextResponse.json({
      data: serializeChannelConfig(data as Record<string, unknown>),
      page_name: profile.data.name,
      subscribed,
      subscribe_error: subscribeError || undefined,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
