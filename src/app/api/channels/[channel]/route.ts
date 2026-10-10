import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  isChannelType,
  mergeChannelConfig,
  serializeChannelConfig,
} from '@/lib/channels/config'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * PUT /api/channels/[channel]
 * Crea o actualiza la config de un canal. Requiere admin+.
 * Los secretos se cifran; si llegan vacíos se conserva el guardado.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ channel: string }> },
) {
  try {
    const { channel } = await context.params
    if (!isChannelType(channel)) return bad('Canal desconocido')

    const ctx = await requireRole('admin')

    const limited = checkRateLimit(
      `channels:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    const incoming =
      body.config && typeof body.config === 'object'
        ? (body.config as Record<string, unknown>)
        : {}

    // Conservamos los secretos ya guardados si el campo llega vacío.
    const { data: existing } = await ctx.supabase
      .from('channel_configs')
      .select('config')
      .eq('account_id', ctx.accountId)
      .eq('channel', channel)
      .maybeSingle()
    const existingConfig =
      (existing?.config as Record<string, unknown> | undefined) ?? {}

    const merged = mergeChannelConfig(channel, incoming, existingConfig)
    if (!merged.ok) return bad(merged.error)

    const { data, error } = await ctx.supabase
      .from('channel_configs')
      .upsert(
        {
          account_id: ctx.accountId,
          channel,
          config: merged.config,
          is_active: Boolean(body.is_active),
        },
        { onConflict: 'account_id,channel' },
      )
      .select('*')
      .single()

    if (error || !data) throw error ?? new Error('upsert failed')

    return NextResponse.json({
      data: serializeChannelConfig(data as Record<string, unknown>),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/channels/[channel]
 * Elimina la config de un canal. Requiere admin+.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ channel: string }> },
) {
  try {
    const { channel } = await context.params
    if (!isChannelType(channel)) return bad('Canal desconocido')

    const ctx = await requireRole('admin')
    const { error } = await ctx.supabase
      .from('channel_configs')
      .delete()
      .eq('account_id', ctx.accountId)
      .eq('channel', channel)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
