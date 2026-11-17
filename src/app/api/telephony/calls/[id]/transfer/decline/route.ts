import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { CallSession } from '@/types';

/**
 * POST /api/telephony/calls/[id]/transfer/decline
 *
 * El agente que recibe una transferencia la rechaza. La llamada NO se
 * cierra: vuelve a la cola con `queued_at = now()` para que el
 * timeout de espera se mida desde este momento. El cliente sigue en
 * la sala de LiveKit escuchando.
 *
 * No incrementa `transfer_count`: rechazar no es una transferencia
 * completada.
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
    if (call.agent_user_id !== ctx.userId) {
      return NextResponse.json(
        { error: 'Esta transferencia no es para ti.' },
        { status: 403 }
      );
    }
    if (call.status !== 'ringing' || !call.transfer_at) {
      return NextResponse.json(
        { error: 'La transferencia ya no está activa. Recarga el softphone.' },
        { status: 409 }
      );
    }

    const { data: updated, error: updateError } = await ctx.supabase
      .from('call_sessions')
      .update({
        status: 'ringing',
        agent_user_id: null,
        agent_profile_id: null,
        transfer_at: null,
        transfer_timeout_seconds: null,
        queued_at: new Date().toISOString(),
      })
      .eq('id', call.id)
      .eq('account_id', ctx.accountId)
      .eq('agent_user_id', ctx.userId)
      .eq('status', 'ringing')
      .not('transfer_at', 'is', null)
      .select('*')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      return NextResponse.json(
        { error: 'La transferencia venció y volvió a la cola.' },
        { status: 409 }
      );
    }

    await ctx.supabase.from('call_events').insert({
      account_id: ctx.accountId,
      call_id: call.id,
      type: 'transfer_declined',
      actor_user_id: ctx.userId,
      payload: {
        from_user_id: call.transfer_from_user_id,
        transfer_count: call.transfer_count,
      },
    });

    return NextResponse.json({ ok: true, call: updated as CallSession });
  } catch (err) {
    return toErrorResponse(err);
  }
}
