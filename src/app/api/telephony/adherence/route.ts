import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  computeAdherenceReport,
  type CallIntervalRow,
  type ShiftRow,
  type StatusEventRow,
} from '@/lib/telephony/adherence';
import { loadTelephonyRoster } from '@/lib/telephony/roster';
import type { AgentShift, AgentStatus, TelephonyAdherenceRow } from '@/types';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 31;
/** Días hacia atrás que se leen para saber el estado al inicio. */
const LOOKBACK_DAYS = 7;
const MAX_ROWS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/telephony/adherence?from=ISO&to=ISO — WEM (admin+).
 *
 * Devuelve, por agente, el tiempo programado (turnos), conectado,
 * disponible, en pausa y hablado dentro de la ventana, más la
 * adherencia al turno y la ocupación. Los turnos se interpretan en
 * hora de Venezuela.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const url = new URL(request.url);
    const now = Date.now();

    const to = parseInstant(url.searchParams.get('to')) ?? now;
    const from =
      parseInstant(url.searchParams.get('from')) ?? to - DEFAULT_DAYS * DAY_MS;

    if (!(from < to)) {
      return NextResponse.json(
        { error: 'La fecha inicial debe ser anterior a la final.' },
        { status: 400 }
      );
    }
    if (to - from > MAX_DAYS * DAY_MS) {
      return NextResponse.json(
        { error: `La ventana máxima es de ${MAX_DAYS} días.` },
        { status: 400 }
      );
    }

    const roster = await loadTelephonyRoster(ctx.supabase, ctx.accountId);
    if (!roster) {
      return NextResponse.json(
        { error: 'No se pudo cargar el equipo del negocio.' },
        { status: 500 }
      );
    }

    const shiftsResult = await ctx.supabase
      .from('agent_shifts')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('weekday', { ascending: true })
      .order('start_time', { ascending: true });

    const shiftsMissing = isMissingRelation(shiftsResult.error);
    if (shiftsResult.error && !shiftsMissing) throw shiftsResult.error;
    const shifts = shiftsMissing ? [] : ((shiftsResult.data ?? []) as AgentShift[]);

    const events = await loadStatusEvents(
      ctx.supabase,
      ctx.accountId,
      from - LOOKBACK_DAYS * DAY_MS,
      to
    );
    const calls = await loadCallIntervals(ctx.supabase, ctx.accountId, from, to);

    const migrationMissing =
      shiftsMissing || events.missing || calls.missing;

    const computed = computeAdherenceReport(
      roster.filter((member) => member.role !== 'viewer').map((m) => m.user_id),
      {
        windowStart: from,
        windowEnd: to,
        shifts: shifts.map<ShiftRow>((shift) => ({
          user_id: shift.user_id,
          weekday: shift.weekday,
          start_time: shift.start_time,
          end_time: shift.end_time,
          break_start: shift.break_start ?? null,
          break_end: shift.break_end ?? null,
        })),
        events: events.rows,
        calls: calls.rows,
      }
    );

    const shiftsByUser = new Map<string, AgentShift[]>();
    for (const shift of shifts) {
      const list = shiftsByUser.get(shift.user_id) ?? [];
      list.push(shift);
      shiftsByUser.set(shift.user_id, list);
    }

    const rows: TelephonyAdherenceRow[] = computed.map((row) => {
      const member = roster.find((entry) => entry.user_id === row.user_id);
      return {
        ...row,
        name: member?.name ?? 'Sin nombre',
        role: member?.role ?? 'agent',
        shifts: shiftsByUser.get(row.user_id) ?? [],
      };
    });

    return NextResponse.json({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      rows,
      migrationMissing,
      truncated: events.truncated || calls.truncated,
      rowLimit: MAX_ROWS,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function parseInstant(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

async function loadStatusEvents(
  db: SupabaseClient,
  accountId: string,
  fromMs: number,
  toMs: number
): Promise<{ rows: StatusEventRow[]; missing: boolean; truncated: boolean }> {
  const { data, error } = await db
    .from('agent_status_log')
    .select('user_id, status, changed_at')
    .eq('account_id', accountId)
    .gte('changed_at', new Date(fromMs).toISOString())
    .lte('changed_at', new Date(toMs).toISOString())
    .order('changed_at', { ascending: true })
    .limit(MAX_ROWS);

  if (error) {
    return { rows: [], missing: isMissingRelation(error), truncated: false };
  }

  const rows = ((data ?? []) as {
    user_id: string;
    status: string;
    changed_at: string;
  }[]).flatMap((row) => {
    if (!isAgentStatus(row.status)) return [];
    return [{ user_id: row.user_id, status: row.status, changed_at: row.changed_at }];
  });

  return { rows, missing: false, truncated: (data ?? []).length >= MAX_ROWS };
}

async function loadCallIntervals(
  db: SupabaseClient,
  accountId: string,
  fromMs: number,
  toMs: number
): Promise<{ rows: CallIntervalRow[]; missing: boolean; truncated: boolean }> {
  const { data, error } = await db
    .from('call_sessions')
    .select('agent_user_id, answered_at, ended_at')
    .eq('account_id', accountId)
    .not('answered_at', 'is', null)
    .gte('answered_at', new Date(fromMs).toISOString())
    .lte('answered_at', new Date(toMs).toISOString())
    .limit(MAX_ROWS);

  if (error) {
    return { rows: [], missing: isMissingRelation(error), truncated: false };
  }

  return {
    rows: (data ?? []) as CallIntervalRow[],
    missing: false,
    truncated: (data ?? []).length >= MAX_ROWS,
  };
}

function isAgentStatus(value: string): value is AgentStatus {
  return (
    value === 'available' ||
    value === 'busy' ||
    value === 'wrap_up' ||
    value === 'break'
  );
}

function isMissingRelation(error: { code?: string } | null): boolean {
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    error?.code === '42703'
  );
}
