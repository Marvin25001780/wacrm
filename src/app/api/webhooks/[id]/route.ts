import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
} from '@/lib/webhooks/endpoints'

/**
 * PATCH /api/webhooks/[id]
 * Activa o desactiva un endpoint. Requiere admin+.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('admin')

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    if (typeof body.is_active !== 'boolean') {
      return NextResponse.json(
        { error: 'is_active (boolean) es obligatorio' },
        { status: 400 },
      )
    }

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .update({ is_active: body.is_active, failure_count: 0 })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    }
    return NextResponse.json({
      data: serializeWebhookEndpoint(data as Record<string, unknown>),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/webhooks/[id]
 * Elimina un endpoint. Requiere admin+.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('admin')

    const { error } = await ctx.supabase
      .from('webhook_endpoints')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
