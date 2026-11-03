import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'

/**
 * POST /api/ai/diagnostic/reply  (admin+)
 *
 * Ejecuta el MOTOR REAL sobre una conversación concreta y devuelve el
 * motivo exacto de lo que pasó: si respondió, si una guarda lo frenó
 * (humano asignado, tope del hilo, automatización, flujo…) o si el
 * envío falló.
 *
 * Es la prueba definitiva: usa el mismo código que el webhook, con el
 * mismo cliente de servicio y las mismas guardas. Si aquí responde y
 * en el webhook no, el problema está en el disparo del webhook y no en
 * la configuración ni en el proveedor.
 *
 * OJO: si responde, el mensaje SÍ le llega al cliente por WhatsApp.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(
      `ai-diagnostic-reply:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string'
        ? body.conversation_id
        : null

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Falta la conversación.' },
        { status: 400 },
      )
    }

    const { data: conv } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (!conv?.contact_id) {
      return NextResponse.json(
        { error: 'Conversación no encontrada.' },
        { status: 404 },
      )
    }

    const outcome = await dispatchInboundToAiReply({
      accountId,
      conversationId,
      contactId: conv.contact_id as string,
      configOwnerUserId: userId,
    })

    return NextResponse.json(outcome)
  } catch (err) {
    return toErrorResponse(err)
  }
}
