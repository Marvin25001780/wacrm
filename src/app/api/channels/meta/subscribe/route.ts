import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  fetchPageSubscriptions,
  subscribePageToApp,
} from '@/lib/channels/meta'

/**
 * POST /api/channels/meta/subscribe
 *
 * Re-suscribe la página al webhook de la app y devuelve qué campos
 * quedaron activos. Sirve para reparar un canal que aparece conectado
 * pero no recibe mensajes, sin tener que reconectar.
 *
 * Body: { channel: 'instagram' | 'facebook' }
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
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

    const { data: row, error } = await ctx.supabase
      .from('channel_configs')
      .select('config, is_active')
      .eq('account_id', ctx.accountId)
      .eq('channel', channel)
      .maybeSingle()
    if (error) throw error

    if (!row || !row.is_active) {
      return NextResponse.json(
        { error: 'El canal no está conectado. Conéctalo primero.' },
        { status: 400 },
      )
    }

    const config = (row.config ?? {}) as Record<string, unknown>
    const pageId = typeof config.page_id === 'string' ? config.page_id : ''

    let accessToken = ''
    try {
      accessToken =
        typeof config.access_token === 'string'
          ? decrypt(config.access_token)
          : ''
    } catch {
      accessToken = ''
    }

    if (!pageId || !accessToken) {
      return NextResponse.json(
        {
          error:
            'Faltan las credenciales de la página. Vuelve a conectar el canal.',
        },
        { status: 400 },
      )
    }

    const subscribed = await subscribePageToApp(pageId, accessToken)
    if (!subscribed.ok) {
      return NextResponse.json(
        { ok: false, error: subscribed.error },
        { status: 400 },
      )
    }

    // Lectura de comprobación: confirma qué campos ve Meta en la página.
    const info = await fetchPageSubscriptions(pageId, accessToken)

    return NextResponse.json({
      ok: true,
      page_id: pageId,
      subscribed_fields: subscribed.data.subscribedFields,
      apps: info.ok ? info.data.apps : [],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
