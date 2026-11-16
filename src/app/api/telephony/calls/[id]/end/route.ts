import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { normalizeHangupReason } from '@/lib/telephony/calls';
import { finalizeCall } from '@/lib/telephony/finalize';
import { stopCallRecording } from '@/lib/telephony/livekit';
import { setAgentStatusRpc } from '@/lib/telephony/status';
import type { CallSession } from '@/types';

/**
 * POST /api/telephony/calls/[id]/end
 * Body: { reason?: 'hangup' | 'declined' | 'failed' | 'timeout' | 'agent_left' }
 *
 * Cierra la sesión, detiene la grabación, escribe la actividad de
 * CRM y deja al agente en "cierre" (wrap-up). Idempotente.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      reason?: unknown;
    };
    const reason = normalizeHangupReason(body.reason);

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
    const unassignedInbound =
      call.direction === 'inbound' &&
      call.agent_user_id === null &&
      call.status === 'ringing';
    if (
      call.agent_user_id !== ctx.userId &&
      ctx.role !== 'owner' &&
      ctx.role !== 'admin' &&
      !unassignedInbound
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let contactName: string | null = null;
    if (call.contact_id) {
      const { data: contact } = await ctx.supabase
        .from('contacts')
        .select('name')
        .eq('id', call.contact_id)
        .maybeSingle();
      contactName = (contact?.name as string | null) ?? null;
    }

    if (call.recording_egress_id) {
      await stopCallRecording(call.recording_egress_id);
    }

    const result = await finalizeCall({
      db: ctx.supabase,
      call,
      reason,
      contactName,
    });

    const { data: updated } = await ctx.supabase
      .from('call_sessions')
      .select('*')
      .eq('id', call.id)
      .maybeSingle();

    // El agente pasa a cierre; el softphone muestra "Wrap-up" y él
    // mismo vuelve a Disponible cuando termina sus notas. Si solo
    // rechazó una entrante ajena, no se le cambia el estado.
    if (call.agent_user_id === ctx.userId) {
      await setAgentStatusRpc(ctx.supabase, 'wrap_up', { source: 'system' });
    }

    return NextResponse.json({ call: updated ?? call, result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
