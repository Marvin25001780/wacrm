import { NextResponse } from 'next/server';

import { loadAiConfig } from '@/lib/ai/config';
import { generateReply } from '@/lib/ai/generate';
import { AiError } from '@/lib/ai/types';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { formatCallDuration } from '@/lib/telephony/calls';
import { formatPhoneDisplay } from '@/lib/telephony/phone';
import {
  buildCallSummaryContent,
  CALL_SUMMARY_SYSTEM_PROMPT,
  cleanCallSummary,
} from '@/lib/telephony/summary';
import type { CallSession } from '@/types';

/**
 * POST /api/telephony/calls/[id]/summary
 *
 * Genera un resumen corto de una llamada ya transcrita con el
 * proveedor de IA del negocio y lo guarda en `ai_summary`.
 *
 * Idempotente: si la llamada ya tiene resumen, lo devuelve sin
 * volver a llamar al proveedor (ni gastar tokens).
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;

    const userLimit = checkRateLimit(
      `call-summary:${ctx.userId}`,
      RATE_LIMITS.callSummary
    );
    if (!userLimit.success) return rateLimitResponse(userLimit);
    const accountLimit = checkRateLimit(
      `call-summary-acct:${ctx.accountId}`,
      RATE_LIMITS.callSummaryAccount
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const { data, error } = await ctx.supabase
      .from('call_sessions')
      .select('*, contact:contacts(id, name, phone)')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'Llamada no encontrada.' },
        { status: 404 }
      );
    }

    const call = data as CallSession;
    if (call.ai_summary) {
      return NextResponse.json({ call });
    }
    if (!call.transcript?.trim()) {
      return NextResponse.json(
        {
          error:
            'Primero transcribe la grabación: el resumen se construye sobre la transcripción.',
        },
        { status: 400 }
      );
    }

    const config = await loadAiConfig(ctx.supabase, ctx.accountId).catch(
      (err) => {
        console.error('[telephony/summary] loadAiConfig error:', err);
        throw new AiError('Stored API key could not be decrypted.', {
          code: 'key_decrypt_failed',
          status: 400,
        });
      }
    );
    if (!config) {
      return NextResponse.json(
        {
          error:
            'El asistente de IA no está configurado. Actívalo en Configuración → Asistente de IA.',
          code: 'ai_not_configured',
        },
        { status: 400 }
      );
    }

    const number =
      call.direction === 'inbound' ? call.from_number : call.to_number;
    const content = buildCallSummaryContent({
      direction: call.direction,
      number,
      contactName: call.contact?.name ?? null,
      durationLabel: formatCallDuration(call.duration_seconds),
      transcript: call.transcript,
    });

    const { text } = await generateReply({
      config,
      systemPrompt: CALL_SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    const summary = cleanCallSummary(text);
    if (!summary) {
      return NextResponse.json(
        { error: 'La IA devolvió un resumen vacío. Inténtalo de nuevo.' },
        { status: 502 }
      );
    }

    const { data: updated, error: updateError } = await ctx.supabase
      .from('call_sessions')
      .update({ ai_summary: summary })
      .eq('id', call.id)
      .select('*, contact:contacts(id, name, phone)')
      .single();
    if (updateError) throw updateError;

    await ctx.supabase.from('call_events').insert({
      account_id: ctx.accountId,
      call_id: call.id,
      type: 'summarized',
      actor_user_id: ctx.userId,
      payload: {
        provider: config.provider,
        model: config.model,
        chars: summary.length,
        counterpart: formatPhoneDisplay(number) || null,
      },
    });

    return NextResponse.json({ call: updated as CallSession });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      );
    }
    return toErrorResponse(err);
  }
}
