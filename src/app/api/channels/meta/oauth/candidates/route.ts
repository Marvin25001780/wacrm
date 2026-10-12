import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/channels/meta/oauth/candidates?channel=instagram|facebook
 *
 * Devuelve las páginas/cuentas que el usuario autorizó en el OAuth y que
 * quedaron pendientes de elegir (el caso de varias páginas). Solo
 * expone id/nombre/usuario — nunca los tokens. Requiere admin+.
 */
export async function GET(request: Request) {
  try {
    const channel = new URL(request.url).searchParams.get('channel')
    if (channel !== 'instagram' && channel !== 'facebook') {
      return NextResponse.json(
        { error: 'Canal desconocido (se espera instagram o facebook)' },
        { status: 400 },
      )
    }

    const ctx = await requireRole('admin')
    const { data } = await ctx.supabase
      .from('channel_configs')
      .select('config')
      .eq('account_id', ctx.accountId)
      .eq('channel', channel)
      .maybeSingle()

    const config = (data?.config as Record<string, unknown> | undefined) ?? {}
    const pending = Array.isArray(config.pending_accounts)
      ? (config.pending_accounts as Record<string, unknown>[])
      : []

    return NextResponse.json({
      data: pending
        .map((p) => ({
          page_id: typeof p.page_id === 'string' ? p.page_id : '',
          name: typeof p.name === 'string' ? p.name : '',
          username: typeof p.username === 'string' ? p.username : '',
        }))
        .filter((p) => p.page_id),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
