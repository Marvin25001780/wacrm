import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { loadActiveAgent } from '@/lib/ai/agent-prompt'
import { buildConversationContext } from '@/lib/ai/context'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { runAgentTurn } from '@/lib/ai/agent-turn'
import type { ChatMessage } from '@/lib/ai/types'

/**
 * POST /api/ai/diagnostic/test  (admin+)
 *
 * Prueba real del camino completo de la IA: proveedor, modelo, clave,
 * agente, conocimiento y prompt. No envía nada al cliente (el turno se
 * ejecuta sin aplicar acciones) y devuelve la respuesta generada o el
 * error exacto del proveedor.
 *
 * Es la pieza que faltaba: una configuración puede verse perfecta en
 * los interruptores y aun así fallar porque el proveedor rechaza el
 * modelo, la cuenta no tiene saldo o el agente devuelve un error. Sin
 * este botón eso solo aparecía en los logs del servidor.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(
      `ai-diagnostic-test:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string'
        ? body.conversation_id
        : null

    const config = await loadAiConfig(supabase, accountId)
    if (!config) {
      return NextResponse.json(
        { error: 'No hay un proveedor de IA configurado con una clave válida.' },
        { status: 400 },
      )
    }

    let messages: ChatMessage[] = []

    if (conversationId) {
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

      messages = await buildConversationContext(supabase, conversationId)
    }

    if (messages.length === 0) {
      messages = [
        {
          role: 'user',
          content: 'Hola, necesito información sobre sus productos.',
        },
      ]
    }

    const agent = await loadActiveAgent(supabase, accountId)

    try {
      if (agent) {
        const turn = await runAgentTurn(supabase, agent, messages, {
          execute: false,
        })
        return NextResponse.json({
          ok: true,
          provider: config.provider,
          model: config.model,
          agent: agent.name,
          reply: turn.reply,
          handoff: turn.handoff,
        })
      }

      const { text, handoff } = await generateReply({
        config,
        systemPrompt: buildSystemPrompt({
          userPrompt: config.systemPrompt,
          mode: 'auto_reply',
        }),
        messages,
      })

      return NextResponse.json({
        ok: true,
        provider: config.provider,
        model: config.model,
        agent: null,
        reply: text,
        handoff,
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'El proveedor no respondió.'
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code ?? '')
          : ''
      console.error('[ai diagnostic test] failed:', err)
      return NextResponse.json({ error: message, code }, { status: 400 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
