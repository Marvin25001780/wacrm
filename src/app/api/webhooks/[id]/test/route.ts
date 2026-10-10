import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { deliverTestEvent } from '@/lib/webhooks/test-delivery'
import { isWebhookEvent, WEBHOOK_EVENTS } from '@/lib/webhooks/events'

/**
 * POST /api/webhooks/[id]/test
 * Entrega un evento de muestra síncrono y devuelve la respuesta del
 * endpoint. Requiere admin+. Acepta `{ event }` opcional; por defecto
 * usa el primer evento conocido.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('admin')

    const limited = checkRateLimit(
      `webhooks-test:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    const event = isWebhookEvent(body.event) ? body.event : WEBHOOK_EVENTS[0]

    const result = await deliverTestEvent(ctx.supabase, ctx.accountId, id, event, {
      message: 'Evento de prueba desde NEXUS CRM',
      sample: true,
    })

    return NextResponse.json({ ...result, event })
  } catch (err) {
    return toErrorResponse(err)
  }
}
