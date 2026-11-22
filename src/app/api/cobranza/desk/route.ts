import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isQueueScope, normalizeQueueSearch } from '@/lib/collections/desk';
import { normalizeSlaMinutes } from '@/lib/collections/response';
import type { CollectionQueueRow } from '@/types/collections';

/**
 * GET /api/cobranza/desk?scope=mine|unassigned|all&q=&segment=&limit=&offset=
 *
 * Cola de trabajo del agente de cobranza (migración 125). El orden lo
 * calcula `collection_agent_queue()`: primero las promesas vencidas o
 * rotas, después las próximas, después la mora y al final lo que aún
 * no vence. Dentro de cada grupo manda la prioridad de la 076.
 *
 * La función valida la pertenencia al negocio y devuelve el total de
 * filas filtradas, así la pantalla puede paginar sin un count extra.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const url = new URL(request.url);

    const rawScope = url.searchParams.get('scope') ?? 'mine';
    const scope = isQueueScope(rawScope) ? rawScope : 'mine';

    const search = normalizeQueueSearch(url.searchParams.get('q') ?? '');
    const rawSegment = (url.searchParams.get('segment') ?? '').trim();

    const rawLimit = Number(url.searchParams.get('limit') ?? 30);
    const limit = Math.min(
      100,
      Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 30)
    );
    const rawOffset = Number(url.searchParams.get('offset') ?? 0);
    const offset =
      Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

    const [queueRes, settingsRes] = await Promise.all([
      ctx.supabase.rpc('collection_agent_queue', {
        p_account_id: ctx.accountId,
        p_scope: scope,
        p_search: search || null,
        p_segment: rawSegment || null,
        p_limit: limit,
        p_offset: offset,
      }),
      // 129 — SLA del negocio para colorear la espera. Si la columna
      // aún no existe, se usa el valor por defecto.
      ctx.supabase
        .from('collection_settings')
        .select('response_sla_minutes')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
    ]);

    const { data, error } = queueRes;
    const responseSlaMinutes = normalizeSlaMinutes(
      settingsRes.data?.response_sla_minutes
    );

    if (error) {
      if (isMissingSchema(error)) {
        return NextResponse.json(
          {
            error:
              'Falta aplicar la migración 125_collection_agent_desk.sql para usar la consola de cobranza.',
            migration: '125',
          },
          { status: 409 }
        );
      }
      throw error;
    }

    const rows = ((data ?? []) as CollectionQueueRow[]).map((row) => ({
      ...row,
      priority_score: Number(row.priority_score) || 0,
      balance: Number(row.balance) || 0,
      overdue_balance: Number(row.overdue_balance) || 0,
      days_overdue_max: Number(row.days_overdue_max) || 0,
      open_installments: Number(row.open_installments) || 0,
      open_promises: Number(row.open_promises) || 0,
      broken_promises: Number(row.broken_promises) || 0,
      awaiting_reply: Boolean(row.awaiting_reply),
      last_inbound_at: row.last_inbound_at ?? null,
      waiting_minutes:
        row.waiting_minutes == null ? null : Number(row.waiting_minutes) || 0,
      total_count: Number(row.total_count) || 0,
    }));

    const total = rows[0]?.total_count ?? 0;

    return NextResponse.json({
      rows,
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
      response_sla_minutes: responseSlaMinutes,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function isMissingSchema(error: { code?: string } | null): boolean {
  return (
    error?.code === '42P01' ||
    error?.code === '42703' ||
    error?.code === '42883' ||
    error?.code === 'PGRST202' ||
    error?.code === 'PGRST205'
  );
}
