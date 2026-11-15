import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadTelephonyRoster } from '@/lib/telephony/roster';
import {
  aggregateCalls,
  businessDayKey,
  BUSINESS_TIME_ZONE,
  type ReportCallRow,
} from '@/lib/telephony/reports';

/**
 * GET /api/telephony/reports?days=7|30|90  (admin+)
 *
 * Reportes de la operación de voz. Lee `call_sessions` desde el inicio
 * del primer día en hora de Caracas y devuelve los agregados que
 * consume `/telefonia/reportes`.
 *
 * Límite duro de 5 000 filas: es un reporte operativo, no un export.
 * Si un negocio lo supera, la respuesta lo indica para que se acote
 * la ventana.
 */
const MAX_ROWS = 5000;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const url = new URL(request.url);
    const rawDays = Number(url.searchParams.get('days') ?? 7);
    const days = Math.min(
      90,
      Math.max(1, Number.isFinite(rawDays) ? Math.floor(rawDays) : 7)
    );

    const now = Date.now();
    const todayKey = businessDayKey(new Date(now).toISOString());
    const firstKey = businessDayKey(
      new Date(now - (days - 1) * 86_400_000).toISOString()
    );
    // Caracas no tiene horario de verano: el inicio del día es -04:00.
    const from = new Date(`${firstKey}T00:00:00-04:00`).toISOString();

    const { data, error } = await ctx.supabase
      .from('call_sessions')
      .select(
        'direction, status, started_at, answered_at, ended_at, duration_seconds, agent_user_id, disposition, recording_url, transcript_status, wrap_up_completed_at'
      )
      .eq('account_id', ctx.accountId)
      .gte('started_at', from)
      .order('started_at', { ascending: false })
      .limit(MAX_ROWS + 1);

    if (error) {
      if (isMissingRelation(error)) {
        return NextResponse.json({
          days,
          from: firstKey,
          to: todayKey,
          timezone: BUSINESS_TIME_ZONE,
          totals: emptyTotals(),
          agents: [],
          daysSeries: [],
          hours: [],
          dispositions: [],
          migrationMissing: true,
        });
      }
      throw error;
    }

    const rows = (data ?? []) as unknown as ReportCallRow[];
    const truncated = rows.length > MAX_ROWS;
    const visible = truncated ? rows.slice(0, MAX_ROWS) : rows;

    const roster = (await loadTelephonyRoster(ctx.supabase, ctx.accountId)) ?? [];

    const report = aggregateCalls(visible, {
      days,
      now,
      roster: roster.map((member) => ({
        user_id: member.user_id,
        name: member.name,
        role: member.role,
      })),
    });

    return NextResponse.json({
      ...report,
      migrationMissing: false,
      truncated,
      rowLimit: MAX_ROWS,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function isMissingRelation(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

function emptyTotals() {
  return {
    total: 0,
    inbound: 0,
    outbound: 0,
    answered: 0,
    answeredInbound: 0,
    missed: 0,
    failed: 0,
    cancelled: 0,
    talkSeconds: 0,
    avgHandleSeconds: null,
    avgWaitSeconds: null,
    answerRate: null,
    abandonmentRate: null,
    recorded: 0,
    transcribed: 0,
    avgWrapUpSeconds: null,
  };
}
