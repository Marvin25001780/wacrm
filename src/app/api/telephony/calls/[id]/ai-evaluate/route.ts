import { NextResponse } from 'next/server';

import { loadAiConfig } from '@/lib/ai/config';
import { generateReply } from '@/lib/ai/generate';
import { AiError } from '@/lib/ai/types';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  AI_QA_SYSTEM_PROMPT,
  buildAiQaContent,
  parseAiEvaluation,
} from '@/lib/telephony/ai-qa';
import { formatCallDuration } from '@/lib/telephony/calls';
import type { CallAiEvaluation, CallSession } from '@/types';

/**
 * GET  /api/telephony/calls/[id]/ai-evaluate — última nota de IA.
 * POST /api/telephony/calls/[id]/ai-evaluate — genera la nota (admin+).
 *
 * Usa la transcripción y el proveedor de IA del negocio. El modelo
 * devuelve notas por criterio; el servidor las valida, recalcula el
 * puntaje y lo guarda en `call_ai_evaluations` (una fila por llamada).
 * Sin transcripción no hay nada que evaluar: se responde 400.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;

    const { data, error } = await ctx.supabase
      .from('call_ai_evaluations')
      .select('*')
      .eq('call_id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      if (isMissingRelation(error)) {
        return NextResponse.json({
          evaluation: null,
          migrationMissing: true,
        });
      }
      throw error;
    }

    return NextResponse.json({
      evaluation: (data as CallAiEvaluation | null) ?? null,
      migrationMissing: false,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await context.params;

    const userLimit = checkRateLimit(
      `call-ai-eval:${ctx.userId}`,
      RATE_LIMITS.callAiEvaluation
    );
    if (!userLimit.success) return rateLimitResponse(userLimit);
    const accountLimit = checkRateLimit(
      `call-ai-eval-acct:${ctx.accountId}`,
      RATE_LIMITS.callAiEvaluationAccount
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
    if (!call.transcript?.trim()) {
      return NextResponse.json(
        {
          error:
            'Primero transcribe la grabación: la IA evalúa sobre la transcripción.',
        },
        { status: 400 }
      );
    }

    const config = await loadAiConfig(ctx.supabase, ctx.accountId).catch(
      (err) => {
        console.error('[telephony/ai-evaluate] loadAiConfig error:', err);
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
    const content = buildAiQaContent({
      transcript: call.transcript,
      direction: call.direction,
      durationLabel: formatCallDuration(call.duration_seconds),
      contactName: call.contact?.name ?? null,
    });

    const { text } = await generateReply({
      config,
      systemPrompt: AI_QA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    const parsed = parseAiEvaluation(text);
    if (!parsed) {
      return NextResponse.json(
        {
          error:
            'La IA devolvió una evaluación ilegible. Inténtalo de nuevo o evalúa manualmente.',
        },
        { status: 502 }
      );
    }

    const { data: saved, error: saveError } = await ctx.supabase
      .from('call_ai_evaluations')
      .upsert(
        {
          account_id: ctx.accountId,
          call_id: call.id,
          agent_user_id: call.agent_user_id,
          score: parsed.score,
          criteria: parsed.criteria,
          provider: config.provider,
          model: config.model,
          summary: parsed.summary || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'call_id' }
      )
      .select('*')
      .single();
    if (saveError) {
      if (isMissingRelation(saveError)) {
        return NextResponse.json(
          {
            error:
              'Falta aplicar la migración 115 (QA automática) en Supabase.',
          },
          { status: 400 }
        );
      }
      throw saveError;
    }

    await ctx.supabase.from('call_events').insert({
      account_id: ctx.accountId,
      call_id: call.id,
      type: 'ai_evaluated',
      actor_user_id: ctx.userId,
      payload: {
        score: parsed.score,
        provider: config.provider,
        model: config.model,
        counterpart: number || null,
      },
    });

    return NextResponse.json({ evaluation: saved as CallAiEvaluation });
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

function isMissingRelation(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}
