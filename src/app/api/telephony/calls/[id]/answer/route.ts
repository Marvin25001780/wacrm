import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadTelephonyConfig, resolveTelephony } from '@/lib/telephony/config';
import { startCallRecording } from '@/lib/telephony/livekit';
import type { CallSession } from '@/types';

/**
 * POST /api/telephony/calls/[id]/answer
 *
 * La llama el softphone cuando LiveKit reporta que la troncal
 * contestó. Marca la sesión como `active`, arranca la grabación si
 * está configurada y registra el evento. Idempotente.
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

    const call = data as CallSession;
    if (
      call.agent_user_id !== ctx.userId &&
      ctx.role !== 'owner' &&
      ctx.role !== 'admin'
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (call.status !== 'ringing') {
      return NextResponse.json({ call });
    }

    const answeredAt = call.answered_at ?? new Date().toISOString();
    const loaded = await loadTelephonyConfig(ctx.supabase, ctx.accountId);
    const resolved = resolveTelephony(loaded);

    let egressId: string | null = null;
    // Una llamada que vuelve a la sala (transferencia) ya puede estar
    // grabándose: no se arranca un segundo egress.
    if (resolved.recordingEnabled && !call.recording_egress_id) {
      try {
        egressId = await startCallRecording({
          room: call.room_name,
          filepath: `recordings/${ctx.accountId}/${call.id}.ogg`,
        });
      } catch (recError) {
        // No se cae la llamada porque falle la grabación.
        console.error('[telephony] no se pudo iniciar la grabación:', recError);
        await ctx.supabase.from('call_events').insert({
          account_id: ctx.accountId,
          call_id: call.id,
          type: 'recording_failed',
          actor_user_id: ctx.userId,
          payload: { message: String(recError).slice(0, 500) },
        });
      }
    }

    const patch: Record<string, unknown> = {
      status: 'active',
      answered_at: answeredAt,
    };
    if (egressId) patch.recording_egress_id = egressId;

    const { data: updated, error: updateError } = await ctx.supabase
      .from('call_sessions')
      .update(patch)
      .eq('id', call.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    await ctx.supabase.from('call_events').insert({
      account_id: ctx.accountId,
      call_id: call.id,
      type: 'answered',
      actor_user_id: ctx.userId,
      payload: { egress_id: egressId },
    });

    return NextResponse.json({
      call: updated as CallSession,
      recording: Boolean(egressId),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
