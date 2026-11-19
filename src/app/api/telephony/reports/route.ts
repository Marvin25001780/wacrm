import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadTelephonyRoster } from '@/lib/telephony/roster';
import {
  aggregateCallbacks,
  aggregateCalls,
  businessDayKey,
  BUSINESS_TIME_ZONE,
  mergeQaScores,
  type QaScoreRow,
  type ReportCallbackRow,
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
          callbacks: aggregateCallbacks([], { now }),
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

    // QA: si la 114 aún no está aplicada, el reporte sigue funcionando
    // sin la columna de calidad. Con la 115 se suman también las
    // evaluaciones automáticas con IA para la comparativa.
    const qaResult = await ctx.supabase
      .from('call_evaluations')
      .select('agent_user_id, score')
      .eq('account_id', ctx.accountId)
      .gte('created_at', from)
      .limit(MAX_ROWS);
    const humanRows =
      qaResult.error && !isMissingRelation(qaResult.error)
        ? []
        : ((qaResult.data ?? []) as QaScoreRow[]).map((row) => ({
            ...row,
            source: 'human' as const,
          }));

    const aiResult = await ctx.supabase
      .from('call_ai_evaluations')
      .select('agent_user_id, score')
      .eq('account_id', ctx.accountId)
      .gte('created_at', from)
      .limit(MAX_ROWS);
    const aiRows =
      aiResult.error && !isMissingRelation(aiResult.error)
        ? []
        : ((aiResult.data ?? []) as QaScoreRow[]).map((row) => ({
            ...row,
            source: 'ai' as const,
          }));

    const reportWithQa = mergeQaScores(report, [...humanRows, ...aiRows]);

    // Devoluciones (122): mismo periodo, por fecha de creación. Si la
    // migración no está aplicada el reporte sigue funcionando y la UI
    // avisa que falta; un error real no se silencia.
    const callbacksResult = await ctx.supabase
      .from('callback_requests')
      .select(
        'status, reason, created_at, claimed_at, completed_at, completed_by, assigned_user_id, source_call_id'
      )
      .eq('account_id', ctx.accountId)
      .gte('created_at', from)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS + 1);

    let callbacksMissing = false;
    let callbacksTruncated = false;
    let callbackRows: ReportCallbackRow[] = [];
    if (callbacksResult.error) {
      if (!isMissingRelation(callbacksResult.error)) throw callbacksResult.error;
      callbacksMissing = true;
    } else {
      const all = (callbacksResult.data ?? []) as ReportCallbackRow[];
      callbacksTruncated = all.length > MAX_ROWS;
      callbackRows = callbacksTruncated ? all.slice(0, MAX_ROWS) : all;
    }

    return NextResponse.json({
      ...reportWithQa,
      callbacks: aggregateCallbacks(callbackRows, {
        now,
        roster: roster.map((member) => ({
          user_id: member.user_id,
          name: member.name,
          role: member.role,
        })),
      }),
      callbacksMissing,
      callbacksTruncated,
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
