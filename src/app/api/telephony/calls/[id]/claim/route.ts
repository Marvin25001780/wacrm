import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isTerminalCallStatus } from '@/lib/telephony/calls';
import { createAgentToken } from '@/lib/telephony/livekit';
import type { CallSession } from '@/types';

/**
 * POST /api/telephony/calls/[id]/claim
 *
 * Un agente toma una llamada entrante que está sonando y todavía no
 * tiene dueño. Devuelve el token de LiveKit para entrar a la sala; al
 * unirse el agente, LiveKit contesta la troncal y el softphone marca
 * la sesión como activa por los atributos SIP.
 *
 * Solo aplica a entrantes en `ringing`. Si otro agente la reclamó
 * primero, 409 (el softphone refresca y la deja de mostrar).
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
    if (call.direction !== 'inbound') {
      return NextResponse.json(
        { error: 'Solo se pueden reclamar llamadas entrantes.' },
        { status: 400 }
      );
    }
    if (isTerminalCallStatus(call.status)) {
      return NextResponse.json(
        { error: 'La llamada ya terminó.' },
        { status: 409 }
      );
    }
    if (call.agent_user_id && call.agent_user_id !== ctx.userId) {
      return NextResponse.json(
        { error: 'Otro agente ya tomó esta llamada.' },
        { status: 409 }
      );
    }

    // Solo los agentes disponibles reciben/atienden la cola. En
    // pausa o en cierre no se puede reclamar una entrante.
    const { data: presence } = await ctx.supabase
      .from('member_presence')
      .select('agent_status')
      .eq('user_id', ctx.userId)
      .maybeSingle();
    const agentStatus =
      (presence as { agent_status?: string } | null)?.agent_status ??
      'available';
    if (agentStatus !== 'available') {
      return NextResponse.json(
        { error: 'Ponte Disponible para contestar llamadas.' },
        { status: 409 }
      );
    }

    let updated: CallSession = call;
    if (!call.agent_user_id) {
      const { data: claimed, error: updateError } = await ctx.supabase
        .from('call_sessions')
        .update({
          agent_profile_id: ctx.profileId,
          agent_user_id: ctx.userId,
          metadata: tabId
            ? { ...(call.metadata ?? {}), tab_id: tabId }
            : call.metadata,
        })
        .eq('id', call.id)
        .is('agent_user_id', null)
        .select('*')
        .maybeSingle();

      // Si la condición `.is(null)` no encontró fila, otro agente ganó
      // la carrera entre el SELECT y el UPDATE.
      if (updateError) throw updateError;
      if (!claimed) {
        return NextResponse.json(
          { error: 'Otro agente ya tomó esta llamada.' },
          { status: 409 }
        );
      }
      updated = claimed as CallSession;
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
      type: 'claimed',
      actor_user_id: ctx.userId,
      payload: { room: call.room_name },
    });

    await ctx.supabase.rpc('set_agent_status', { p_status: 'busy' });

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
