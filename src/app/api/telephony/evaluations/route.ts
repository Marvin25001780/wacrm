import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isTerminalCallStatus } from '@/lib/telephony/calls';
import {
  computeEvaluationScore,
  normalizeCriteria,
} from '@/lib/telephony/qa';
import type { CallEvaluation, CallSession } from '@/types';

/**
 * GET  /api/telephony/evaluations?callId=...  (agent+)
 * POST /api/telephony/evaluations              (admin+)
 *
 * QA de llamadas. El GET con `callId` devuelve la evaluación de esa
 * llamada (o null) para el diálogo de detalle; sin parámetro lista las
 * últimas 100 del negocio.
 *
 * El POST es un upsert por `call_id`: una llamada tiene una sola
 * evaluación. El puntaje (0–100) y la rúbrica normalizada se calculan
 * en el servidor; el cliente solo manda las notas por criterio.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const url = new URL(request.url);
    const callId = url.searchParams.get('callId');

    let query = ctx.supabase
      .from('call_evaluations')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (callId) {
      query = query.eq('call_id', callId).limit(1);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingRelation(error)) {
        return NextResponse.json({
          evaluations: [],
          evaluation: null,
          migrationMissing: true,
        });
      }
      throw error;
    }

    const evaluations = (data ?? []) as CallEvaluation[];
    if (callId) {
      return NextResponse.json({
        evaluation: evaluations[0] ?? null,
        migrationMissing: false,
      });
    }
    return NextResponse.json({ evaluations, migrationMissing: false });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => ({}))) as {
      callId?: unknown;
      criteria?: unknown;
      comments?: unknown;
    };

    const callId = typeof body.callId === 'string' ? body.callId : '';
    if (!callId) {
      return NextResponse.json(
        { error: 'Falta la llamada a evaluar.' },
        { status: 400 }
      );
    }

    if (
      !body.criteria ||
      typeof body.criteria !== 'object' ||
      Array.isArray(body.criteria)
    ) {
      return NextResponse.json(
        { error: 'Faltan las notas de la rúbrica.' },
        { status: 400 }
      );
    }

    const raw: Record<string, number> = {};
    for (const [key, value] of Object.entries(
      body.criteria as Record<string, unknown>
    )) {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) {
        return NextResponse.json(
          { error: `Nota inválida para el criterio "${key}".` },
          { status: 400 }
        );
      }
      raw[key] = numeric;
    }

    let comments: string | null = null;
    if (body.comments !== undefined && body.comments !== null) {
      if (typeof body.comments !== 'string') {
        return NextResponse.json(
          { error: 'Los comentarios deben ser texto.' },
          { status: 400 }
        );
      }
      comments = body.comments.trim().slice(0, 2000) || null;
    }

    const { data, error } = await ctx.supabase
      .from('call_sessions')
      .select('*')
      .eq('id', callId)
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
    if (!isTerminalCallStatus(call.status) || !call.answered_at) {
      return NextResponse.json(
        { error: 'Solo se evalúan llamadas contestadas y cerradas.' },
        { status: 400 }
      );
    }

    const score = computeEvaluationScore(raw);
    const criteria = normalizeCriteria(raw);

    const { data: saved, error: saveError } = await ctx.supabase
      .from('call_evaluations')
      .upsert(
        {
          account_id: ctx.accountId,
          call_id: call.id,
          agent_user_id: call.agent_user_id,
          evaluator_user_id: ctx.userId,
          score,
          criteria,
          comments,
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
              'Falta aplicar la migración 114 (evaluaciones de calidad) en Supabase.',
          },
          { status: 400 }
        );
      }
      throw saveError;
    }

    await ctx.supabase.from('call_events').insert({
      account_id: ctx.accountId,
      call_id: call.id,
      type: 'evaluated',
      actor_user_id: ctx.userId,
      payload: { score },
    });

    return NextResponse.json({ evaluation: saved as CallEvaluation });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function isMissingRelation(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}
