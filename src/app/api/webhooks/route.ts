import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'
import { normalizeEvents } from '@/lib/webhooks/events'
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
  generateWebhookSecret,
  normalizeWebhookUrl,
} from '@/lib/webhooks/endpoints'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/webhooks
 * Lista los endpoints de webhook de la cuenta (cualquier miembro).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('webhook_endpoints')
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({
      data: (data ?? []).map((r) =>
        serializeWebhookEndpoint(r as Record<string, unknown>),
      ),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/webhooks
 * Crea un endpoint. Requiere admin+. Devuelve el `secret` una sola vez.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const limited = checkRateLimit(
      `webhooks:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >

    const url = normalizeWebhookUrl(body.url)
    if (!url) return bad('La URL debe ser válida y usar https://')

    const events = normalizeEvents(body.events)
    if (!events) return bad('Selecciona al menos un evento válido')

    const secret = generateWebhookSecret()

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        url,
        secret: encrypt(secret),
        events,
      })
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .single()

    if (error || !data) throw error ?? new Error('insert failed')

    return NextResponse.json(
      {
        data: serializeWebhookEndpoint(data as Record<string, unknown>),
        secret,
      },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
