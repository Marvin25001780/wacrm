import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { subscribePageToApp } from '@/lib/channels/meta'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/channels/meta/oauth/select
 *
 * Cierra el OAuth cuando el usuario autorizó varias páginas: promueve la
 * elegida (por `page_id`) a credenciales activas y limpia las
 * pendientes. El token ya viene cifrado desde el callback — no se
 * descifra ni se re-cifra aquí.
 *
 * Body: { channel: 'instagram'|'facebook', page_id: string }
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limited = checkRateLimit(
      `channels-meta-select:${ctx.userId}`,
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
        { error: 'Falta la página a conectar' },
        { status: 400 },
      )
    }

    const { data: row } = await ctx.supabase
      .from('channel_configs')
      .select('config')
      .eq('account_id', ctx.accountId)
      .eq('channel', channel)
      .maybeSingle()

    const existing =
      (row?.config as Record<string, unknown> | undefined) ?? {}
    const pending = Array.isArray(existing.pending_accounts)
      ? (existing.pending_accounts as Record<string, unknown>[])
      : []
    const chosen = pending.find(
      (p) => typeof p.page_id === 'string' && p.page_id === pageId,
    )
    if (!chosen || typeof chosen.access_token !== 'string' || !chosen.access_token) {
      return NextResponse.json(
        { error: 'La página elegida ya no está disponible. Vuelve a conectar.' },
        { status: 409 },
      )
    }

    const appSecret = process.env.META_APP_SECRET || ''
    const config: Record<string, unknown> = {
      ...existing,
      page_id: pageId,
      page_name: typeof chosen.name === 'string' ? chosen.name : '',
      access_token: chosen.access_token,
      app_secret: appSecret ? encrypt(appSecret) : existing.app_secret,
      verify_token:
        typeof existing.verify_token === 'string' && existing.verify_token
          ? existing.verify_token
          : `nexus_${randomUUID().replace(/-/g, '')}`,
      pending_accounts: [],
    }

    const { data, error } = await ctx.supabase
      .from('channel_configs')
      .upsert(
        {
          account_id: ctx.accountId,
          channel,
          config,
          is_active: true,
        },
        { onConflict: 'account_id,channel' },
      )
      .select('id')
      .single()

    if (error || !data) throw error ?? new Error('upsert failed')

    // Activar la entrega de eventos: sin esta suscripción Meta no envía
    // mensajes de la página ni de su cuenta de Instagram vinculada.
    let subscribed = true
    let subscribeError = ''
    try {
      const pageToken = decrypt(chosen.access_token)
      const result = await subscribePageToApp(pageId, pageToken)
      if (!result.ok) {
        subscribed = false
        subscribeError = result.error
        console.error('[meta-select] page subscription failed:', result.error)
      }
    } catch (err) {
      subscribed = false
      subscribeError =
        err instanceof Error ? err.message : 'No se pudo suscribir la página'
      console.error('[meta-select] page subscription threw:', err)
    }

    return NextResponse.json({
      success: true,
      page_name: typeof chosen.name === 'string' ? chosen.name : '',
      subscribed,
      subscribe_error: subscribeError || undefined,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
