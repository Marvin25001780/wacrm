import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { transcribeCallRecording } from '@/lib/telephony/transcribe-call';
import type { CallSession } from '@/types';

/**
 * POST /api/telephony/calls/[id]/transcribe
 *
 * Transcribe la grabación con el proveedor de IA del negocio (OpenAI,
 * Groq o Gemini). La lógica vive en `transcribe-call.ts` porque el
 * webhook de Egress la usa igual cuando la transcripción automática
 * está activada.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;

    const { data, error } = await ctx.supabase
      .from('call_sessions')
      .select('*')
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

    const outcome = await transcribeCallRecording(
      ctx.supabase,
      data as CallSession,
      { actorUserId: ctx.userId, source: 'manual' }
    );

    if (!outcome.call) {
      return NextResponse.json(
        { error: outcome.error ?? 'No se pudo transcribir la llamada.' },
        { status: outcome.status ?? 502 }
      );
    }

    return NextResponse.json({ call: outcome.call });
  } catch (err) {
    return toErrorResponse(err);
  }
}
