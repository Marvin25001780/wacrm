import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { AGENT_STATUSES, type AgentStatus } from '@/types';

const VALID = new Set<AgentStatus>(AGENT_STATUSES.map((s) => s.value));

/**
 * POST /api/telephony/presence
 * Body: { status: 'available' | 'busy' | 'wrap_up' | 'break' }
 *
 * Solo cambia el estado del propio agente. La cuenta se deriva de la
 * sesión en el RPC `set_agent_status`.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => ({}))) as {
      status?: unknown;
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

    const { error } = await ctx.supabase.rpc('set_agent_status', {
      p_status: body.status,
    });

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
