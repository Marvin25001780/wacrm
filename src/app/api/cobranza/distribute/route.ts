import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { clampPerAgent } from '@/lib/collections/supervision';
import type { CollectionDistributionResult } from '@/types/collections';

const SEGMENTS = new Set([
  'preventiva',
  'temprana',
  'media',
  'tardia',
  'critica',
]);

/**
 * POST /api/cobranza/distribute
 * Body: { perAgent?: number, segment?: string | null }
 *
 * Solo admin/owner. Reparte deudores sin asignar entre los gestores
 * con rol `agent`, empezando por el que menos cartera tiene. Nunca
 * mueve casos ya asignados. Es idempotente: si no queda nada libre,
 * devuelve 0.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => ({}))) as {
      perAgent?: unknown;
      segment?: unknown;
    };

    const perAgent = clampPerAgent(body.perAgent ?? 10);
    const rawSegment =
      typeof body.segment === 'string' ? body.segment.trim().toLowerCase() : '';
    const segment = SEGMENTS.has(rawSegment) ? rawSegment : null;

    const { data, error } = await ctx.supabase.rpc(
      'collection_distribute_unassigned',
      {
        p_account_id: ctx.accountId,
        p_per_agent: perAgent,
        p_segment: segment,
      }
    );

    if (error) {
      if (
        error.code === '42883' ||
        error.code === 'PGRST202' ||
        error.code === 'PGRST205'
      ) {
        return NextResponse.json(
          {
            error:
              'Falta aplicar la migración 126_collection_supervision.sql para repartir cartera.',
            migration: '126',
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: error.message ?? 'No se pudo repartir la cartera.' },
        { status: 409 }
      );
    }

    const result = (data ?? {
      assigned: 0,
      agents: 0,
      per_agent: perAgent,
      segment,
      breakdown: [],
    }) as CollectionDistributionResult;

    return NextResponse.json({
      ...result,
      assigned: Number(result.assigned) || 0,
      agents: Number(result.agents) || 0,
      per_agent: Number(result.per_agent) || perAgent,
      breakdown: Array.isArray(result.breakdown) ? result.breakdown : [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
