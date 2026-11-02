import { NextResponse } from 'next/server'

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { buildAiDiagnostic } from '@/lib/ai/diagnostic'

/**
 * GET /api/ai/diagnostic
 *
 * Devuelve por qué el agente de IA responde o no responde en esta
 * cuenta. Lo consume Ajustes → Asistente de IA. Solo lectura: no
 * cambia ninguna configuración ni envía mensajes.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const diagnostic = await buildAiDiagnostic(supabase, accountId)
    return NextResponse.json(diagnostic)
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/diagnostic  (admin+)
 *
 * Devuelve un hilo al bot: quita la asignación a un humano, reinicia
 * el contador de respuestas y libera el lock. Es la acción que evita
 * tener que tocar la base para desbloquear una conversación que se
 * quedó muda tras tres respuestas o tras una derivación.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

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
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (!conv) {
      return NextResponse.json(
        { error: 'Conversación no encontrada.' },
        { status: 404 },
      )
    }

    const { error } = await supabase
      .from('conversations')
      .update({
        assigned_agent_id: null,
        ai_reply_count: 0,
        ai_autoreply_disabled: false,
        ai_processing_at: null,
      })
      .eq('id', conversationId)
      .eq('account_id', accountId)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

