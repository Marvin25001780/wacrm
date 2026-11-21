import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { normalizeDays } from '@/lib/collections/supervision';
import { loadMemberPresence } from '@/lib/telephony/roster';
import type {
  CollectionSupervisorPresence,
  CollectionSupervisorPromise,
  CollectionSupervisorRow,
  CollectionSupervisorTotals,
} from '@/types/collections';

/**
 * GET /api/cobranza/supervision?days=7
 *
 * Tablero del supervisor (migración 126): una fila por gestor con su
 * carga, gestiones de hoy, PTP y promesas en riesgo; la lista de
 * promesas abiertas que vencen en la ventana; y los totales de cartera
 * y reparto pendiente.
 *
 * "Hoy" lo decide el servidor con la zona horaria del negocio; el
 * navegador no calcula fechas para evitar cortes distintos según el
 * equipo del supervisor.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const url = new URL(request.url);
    const days = normalizeDays(url.searchParams.get('days'));

    const [boardRes, promisesRes, totalsRes] = await Promise.all([
      ctx.supabase.rpc('collection_supervisor_board', {
        p_account_id: ctx.accountId,
      }),
      ctx.supabase.rpc('collection_supervisor_promises', {
        p_account_id: ctx.accountId,
        p_days: days,
        p_limit: 300,
      }),
      ctx.supabase.rpc('collection_supervisor_totals', {
        p_account_id: ctx.accountId,
      }),
    ]);

    const failed = [boardRes.error, promisesRes.error, totalsRes.error].find(Boolean);
    if (failed) return rpcError(failed);

    const board = ((boardRes.data ?? []) as CollectionSupervisorRow[]).map((row) => ({
      ...row,
      assigned_count: Number(row.assigned_count) || 0,
      balance_assigned: Number(row.balance_assigned) || 0,
      overdue_assigned: Number(row.overdue_assigned) || 0,
      actions_today: Number(row.actions_today) || 0,
      contacts_today: Number(row.contacts_today) || 0,
      ptp_today: Number(row.ptp_today) || 0,
      promises_due_today: Number(row.promises_due_today) || 0,
      promises_overdue: Number(row.promises_overdue) || 0,
      broken_promises_30d: Number(row.broken_promises_30d) || 0,
    }));

    const promises = ((promisesRes.data ?? []) as CollectionSupervisorPromise[]).map(
      (row) => ({
        ...row,
        amount: Number(row.amount) || 0,
        days_left: Number(row.days_left) || 0,
      })
    );

    const totalsRaw = Array.isArray(totalsRes.data)
      ? (totalsRes.data[0] as CollectionSupervisorTotals | undefined)
      : (totalsRes.data as CollectionSupervisorTotals | null);

    const totals: CollectionSupervisorTotals = {
      portfolio_size: Number(totalsRaw?.portfolio_size) || 0,
      portfolio_balance: Number(totalsRaw?.portfolio_balance) || 0,
      portfolio_overdue: Number(totalsRaw?.portfolio_overdue) || 0,
      unassigned_count: Number(totalsRaw?.unassigned_count) || 0,
      unassigned_balance: Number(totalsRaw?.unassigned_balance) || 0,
      assigned_count: Number(totalsRaw?.assigned_count) || 0,
      agents_total: Number(totalsRaw?.agents_total) || 0,
      agents_with_portfolio: Number(totalsRaw?.agents_with_portfolio) || 0,
    };

    // La presencia es informativa: si la tabla aún no existe o falla,
    // el tablero sigue mostrando el trabajo del equipo.
    let presence: CollectionSupervisorPresence[] = [];
    try {
      presence = (await loadMemberPresence(ctx.supabase, ctx.accountId)).map((row) => ({
        user_id: row.user_id,
        status: row.status,
        agent_status: row.agent_status,
        last_seen_at: row.last_seen_at,
      }));
    } catch (presenceError) {
      console.warn('[cobranza/supervision] presencia no disponible:', presenceError);
    }

    return NextResponse.json({
      board,
      promises,
      totals,
      presence,
      days,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function rpcError(error: { code?: string; message?: string }): NextResponse {
  if (
    error.code === '42883' ||
    error.code === '42P01' ||
    error.code === '42703' ||
    error.code === 'PGRST202' ||
    error.code === 'PGRST205'
  ) {
    return NextResponse.json(
      {
        error:
          'Falta aplicar la migración 126_collection_supervision.sql para usar la supervisión de cobranza.',
        migration: '126',
      },
      { status: 409 }
    );
  }
  return NextResponse.json(
    { error: error.message ?? 'No se pudo cargar la supervisión.' },
    { status: 409 }
  );
}
