import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { setAgentStatusRpc } from '@/lib/telephony/status';
import { AGENT_STATUSES, type AgentStatus } from '@/types';

const VALID = new Set<AgentStatus>(AGENT_STATUSES.map((s) => s.value));

/**
 * POST /api/telephony/presence
 * Body: {
 *   status: 'available' | 'busy' | 'wrap_up' | 'break',
 *   reason?: string   // solo para 'break' (migración 120)
 * }
 *
 * Solo cambia el estado del propio agente. La cuenta se deriva de la
 * sesión en el RPC `set_agent_status`. El motivo se guarda en la
 * bitácora (`agent_status_log`) para la adherencia; si la 120 no está
 * aplicada, se reintenta sin motivo para no romper el cambio de
 * estado (el softphone seguiría funcionando).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => ({}))) as {
      status?: unknown;
      reason?: unknown;
    };

    if (
      typeof body.status !== 'string' ||
      !VALID.has(body.status as AgentStatus)
    ) {
      return NextResponse.json(
        { error: 'Estado de agente inválido.' },
        { status: 400 }
      );
    }

    // Motivo: texto corto y libre; la app manda la clave de la lista
    // fija (PAUSE_REASONS) y la base recorta a 60 caracteres. El
    // helper reintenta sin motivo si la 120 no está aplicada.
    const { error } = await setAgentStatusRpc(
      ctx.supabase,
      body.status as AgentStatus,
      {
        reason:
          body.status === 'break' && typeof body.reason === 'string'
            ? body.reason
            : null,
        source: 'agent',
      }
    );

    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        return NextResponse.json(
          {
            error:
              'Falta aplicar la migración 112_telephony.sql (función set_agent_status).',
          },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: true, status: body.status });
  } catch (err) {
    return toErrorResponse(err);
  }
}
