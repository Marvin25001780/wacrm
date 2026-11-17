import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { derivePresence } from '@/lib/presence';
import { loadTelephonyRoster } from '@/lib/telephony/roster';
import { transferTargetBlockReason } from '@/lib/telephony/transfers';
import type {
  AgentStatus,
  TelephonyTransferTarget,
  TelephonyTransferTargets,
} from '@/types';

const AGENT_STATUSES = new Set<AgentStatus>([
  'available',
  'busy',
  'wrap_up',
  'break',
]);

/**
 * GET /api/telephony/transfer-targets — agentes del negocio a los que
 * se les puede pasar una llamada (agente+).
 *
 * Devuelve a todos los que atienden llamadas con su estado actual y,
 * cuando no pueden recibirla, el motivo (`blockReason`) para que el
 * softphone lo explique en vez de ofrecer un botón que fallaría.
 */
export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const now = Date.now();

    const [roster, presenceResult, liveResult] = await Promise.all([
      loadTelephonyRoster(ctx.supabase, ctx.accountId),
      ctx.supabase
        .from('member_presence')
        .select('user_id, status, last_seen_at, agent_status')
        .eq('account_id', ctx.accountId),
      ctx.supabase
        .from('call_sessions')
        .select('agent_user_id')
        .eq('account_id', ctx.accountId)
        .in('status', ['ringing', 'active'])
        .not('agent_user_id', 'is', null),
    ]);

    if (!roster) {
      return NextResponse.json(
        { error: 'No se pudo cargar el equipo del negocio.' },
        { status: 500 }
      );
    }
    if (presenceResult.error) throw presenceResult.error;

    const migrationMissing = Boolean(
      liveResult.error &&
        (liveResult.error.code === '42P01' ||
          liveResult.error.code === 'PGRST205')
    );
    if (liveResult.error && !migrationMissing) throw liveResult.error;

    const presenceByUser = new Map(
      (
        (presenceResult.data ?? []) as {
          user_id: string;
          status: 'online' | 'away';
          last_seen_at: string;
          agent_status: AgentStatus;
        }[]
      ).map((row) => [row.user_id, row])
    );

    const busyUsers = new Set(
      ((liveResult.data ?? []) as { agent_user_id: string | null }[])
        .map((row) => row.agent_user_id)
        .filter((id): id is string => Boolean(id))
    );

    const targets: TelephonyTransferTarget[] = roster
      .filter((member) => member.role !== 'viewer')
      .map((member) => {
        const presence = presenceByUser.get(member.user_id);
        const agentStatus =
          presence?.agent_status && AGENT_STATUSES.has(presence.agent_status)
            ? presence.agent_status
            : 'available';
        const busy = busyUsers.has(member.user_id);
        return {
          user_id: member.user_id,
          name: member.name,
          role: member.role,
          agent_status: agentStatus,
          presence: derivePresence(
            presence?.status,
            presence?.last_seen_at,
            now
          ),
          skills: member.skills,
          busy,
          blockReason: transferTargetBlockReason({
            userId: member.user_id,
            callerUserId: ctx.userId,
            role: member.role,
            agentStatus,
            hasLiveCall: busy,
          }),
        };
      })
      .sort((a, b) => {
        // Primero quien puede recibirla, luego por nombre.
        const aBlocked = a.blockReason ? 1 : 0;
        const bBlocked = b.blockReason ? 1 : 0;
        if (aBlocked !== bBlocked) return aBlocked - bBlocked;
        return a.name.localeCompare(b.name);
      });

    const payload: TelephonyTransferTargets = {
      targets,
      migrationMissing,
    };
    return NextResponse.json(payload);
  } catch (err) {
    return toErrorResponse(err);
  }
}
