import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadTelephonyConfig, resolveTelephony } from '@/lib/telephony/config';
import { removeAgentFromRoom } from '@/lib/telephony/livekit';
import { loadTelephonyRoster } from '@/lib/telephony/roster';
import { setAgentStatusRpc } from '@/lib/telephony/status';
import {
  canTransferCall,
  transferTargetBlockReason,
} from '@/lib/telephony/transfers';
import type { CallSession } from '@/types';

/**
 * POST /api/telephony/calls/[id]/transfer
 *
 * Body: { toUserId: string }  → transferencia a otro agente
 *       { toQueue: true }     → devolver la llamada a la cola
 *
 * Solo el agente que atiende la llamada puede transferirla. La sala
 * de LiveKit no se cierra: el cliente sigue dentro y el nuevo agente
 * entra con un token nuevo. El agente que transfiere sale de la sala
 * y queda Disponible (no entra en cierre: no terminó la conversación).
 *
 * Si el nuevo agente no contesta en `transfer_ring_timeout_seconds`,
 * `release_expired_transfers` la devuelve a la cola.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      toUserId?: unknown;
      toQueue?: unknown;
    };
    const toQueue = body.toQueue === true;
    const toUserId =
      typeof body.toUserId === 'string' && body.toUserId
        ? body.toUserId
        : null;

    if (!toQueue && !toUserId) {
      return NextResponse.json(
        { error: 'Indica el agente de destino o la cola.' },
        { status: 400 }
      );
    }

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
        { error: 'Solo el agente que atiende la llamada puede transferirla.' },
        { status: 403 }
      );
    }

    const loaded = await loadTelephonyConfig(ctx.supabase, ctx.accountId);
    const resolved = resolveTelephony(loaded);

    const allowed = canTransferCall({
      status: call.status,
      transferCount: call.transfer_count,
      maxTransfers: resolved.maxTransfersPerCall,
    });
    if (!allowed.ok) {
      return NextResponse.json(
        { error: allowed.reason },
        { status: 409 }
      );
    }

    // ---- Devolver a la cola -----------------------------------
    if (toQueue) {
      const updated = await updateOwnedCall(ctx.supabase, {
        call,
        userId: ctx.userId,
        patch: {
          status: 'ringing',
          agent_user_id: null,
          agent_profile_id: null,
          transfer_at: null,
          transfer_timeout_seconds: null,
          transfer_count: (call.transfer_count ?? 0) + 1,
          queued_at: new Date().toISOString(),
        },
      });
      if (!updated) return raceResponse();

      await removeAgentFromRoom({
        room: call.room_name,
        userId: ctx.userId,
      }).catch(() => undefined);
      await recordEvent(ctx.supabase, {
        accountId: ctx.accountId,
        callId: call.id,
        type: 'transferred_to_queue',
        userId: ctx.userId,
        payload: { transfer_count: updated.transfer_count },
      });
      await setAgentStatusRpc(ctx.supabase, 'available', { source: 'system' });

      return NextResponse.json({ ok: true, call: updated });
    }

    // ---- Transferencia a otro agente ---------------------------
    const targetUserId = toUserId as string;
    if (targetUserId === ctx.userId) {
      return NextResponse.json(
        { error: 'No puedes transferirte a ti mismo.' },
        { status: 400 }
      );
    }

    const [roster, presence, targetCall, targetProfile] = await Promise.all([
      loadTelephonyRoster(ctx.supabase, ctx.accountId),
      ctx.supabase
        .from('member_presence')
        .select('agent_status')
        .eq('account_id', ctx.accountId)
        .eq('user_id', targetUserId)
        .maybeSingle(),
      ctx.supabase
        .from('call_sessions')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('agent_user_id', targetUserId)
        .in('status', ['ringing', 'active'])
        .limit(1),
      ctx.supabase
        .from('profiles')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('user_id', targetUserId)
        .maybeSingle(),
    ]);

    if (!roster) {
      return NextResponse.json(
        { error: 'No se pudo cargar el equipo del negocio.' },
        { status: 500 }
      );
    }
    const member = roster.find((row) => row.user_id === targetUserId);
    if (!member) {
      return NextResponse.json(
        { error: 'Ese agente no pertenece a este negocio.' },
        { status: 400 }
      );
    }
    if (presence.error) throw presence.error;
    if (targetCall.error) throw targetCall.error;
    if (targetProfile.error) throw targetProfile.error;

    const blockReason = transferTargetBlockReason({
      userId: targetUserId,
      callerUserId: ctx.userId,
      role: member.role,
      agentStatus:
        (presence.data as { agent_status?: string } | null)?.agent_status ??
        'available',
      hasLiveCall: (targetCall.data ?? []).length > 0,
    });
    if (blockReason) {
      return NextResponse.json({ error: blockReason }, { status: 409 });
    }
    if (!targetProfile.data) {
      return NextResponse.json(
        { error: 'Ese agente no tiene perfil en este negocio.' },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const timeoutSeconds = resolved.transferRingTimeoutSeconds;
    const metadata = { ...(call.metadata ?? {}) };
    delete metadata.tab_id;

    const updated = await updateOwnedCall(ctx.supabase, {
      call,
      userId: ctx.userId,
      patch: {
        status: 'ringing',
        agent_user_id: targetUserId,
        agent_profile_id: targetProfile.data.id as string,
        transfer_from_user_id: ctx.userId,
        transfer_at: nowIso,
        transfer_timeout_seconds: timeoutSeconds,
        transfer_count: (call.transfer_count ?? 0) + 1,
        queued_at: null,
        metadata,
      },
    });
    if (!updated) return raceResponse();

    await removeAgentFromRoom({ room: call.room_name, userId: ctx.userId }).catch(
      () => undefined
    );
    await recordEvent(ctx.supabase, {
      accountId: ctx.accountId,
      callId: call.id,
      type: 'transfer',
      userId: ctx.userId,
      payload: {
        from_user_id: ctx.userId,
        to_user_id: targetUserId,
        to_name: member.name,
        timeout_seconds: timeoutSeconds,
        transfer_count: updated.transfer_count,
      },
    });
    await setAgentStatusRpc(ctx.supabase, 'available', { source: 'system' });

    return NextResponse.json({ ok: true, call: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Actualiza la llamada solo si sigue siendo del agente y sigue
 * `active`. Evita pisar un cierre o una transferencia simultánea.
 */
async function updateOwnedCall(
  db: SupabaseClient,
  args: {
    call: CallSession;
    userId: string;
    patch: Record<string, unknown>;
  }
): Promise<CallSession | null> {
  const { data, error } = await db
    .from('call_sessions')
    .update(args.patch)
    .eq('id', args.call.id)
    .eq('account_id', args.call.account_id)
    .eq('agent_user_id', args.userId)
    .eq('status', 'active')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return (data as CallSession | null) ?? null;
}

function raceResponse() {
  return NextResponse.json(
    { error: 'La llamada cambió de estado. Recarga el softphone.' },
    { status: 409 }
  );
}

async function recordEvent(
  db: SupabaseClient,
  args: {
    accountId: string;
    callId: string;
    type: string;
    userId: string;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await db.from('call_events').insert({
    account_id: args.accountId,
    call_id: args.callId,
    type: args.type,
    actor_user_id: args.userId,
    payload: args.payload,
  });
  if (error) {
    console.warn('[telephony] no se pudo registrar la transferencia:', error);
  }
}
