import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createAgentToken } from '@/lib/telephony/livekit';
import { setAgentStatusRpc } from '@/lib/telephony/status';
import type { CallSession } from '@/types';

/**
 * POST /api/telephony/calls/[id]/transfer/accept
 *
 * El agente que recibe una transferencia la acepta. Devuelve el token
 * de LiveKit para entrar a la sala que ya está viva; la sesión sigue
 * en `ringing` hasta que la troncal confirme (lo hace `/answer`).
 *
 * Body: { tabId?: string }
 *
 * El UPDATE limpia `transfer_at` con guard: si el barrido ya la
 * devolvió a la cola, no hay fila y se responde 409.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      tabId?: unknown;
    };
    const tabId =
      typeof body.tabId === 'string' ? body.tabId.slice(0, 100) : null;

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

    const { data: presence } = await ctx.supabase
      .from('member_presence')
      .select('agent_status')
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    const agentStatus =
      (presence as { agent_status?: string } | null)?.agent_status ??
      'available';
    if (agentStatus !== 'available') {
      return NextResponse.json(
        { error: 'Ponte Disponible para recibir la transferencia.' },
        { status: 409 }
      );
    }

    const metadata = { ...(call.metadata ?? {}) };
    if (tabId) metadata.tab_id = tabId;

    const { data: updated, error: updateError } = await ctx.supabase
      .from('call_sessions')
      .update({
        transfer_at: null,
        transfer_timeout_seconds: null,
        metadata,
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

    const token = await createAgentToken({
      room: call.room_name,
      identity: `user-${ctx.userId}`,
      name: ctx.account.name,
      metadata: { account_id: ctx.accountId, user_id: ctx.userId },
    });

    await ctx.supabase.from('call_events').insert({
      account_id: ctx.accountId,
      call_id: call.id,
      type: 'transfer_accepted',
      actor_user_id: ctx.userId,
      payload: {
        from_user_id: call.transfer_from_user_id,
        transfer_count: call.transfer_count,
      },
    });

    await setAgentStatusRpc(ctx.supabase, 'busy', { source: 'system' });

    return NextResponse.json({
      call: updated as CallSession,
      token: token.token,
      url: token.url,
      room: call.room_name,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
