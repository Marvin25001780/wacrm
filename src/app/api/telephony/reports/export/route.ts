import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadTelephonyRoster } from '@/lib/telephony/roster';
import { businessDayKey } from '@/lib/telephony/reports';
import {
  buildAgentsCsv,
  buildCallbacksCsv,
  buildCallsCsv,
  buildSummaryCsv,
  exportFileName,
  isExportDataset,
  type CallExportRow,
  type CallbackExportRow,
} from '@/lib/telephony/export';
import {
  aggregateCallbacks,
  aggregateCalls,
  mergeQaScores,
  type QaScoreRow,
  type ReportCallbackRow,
  type ReportCallRow,
} from '@/lib/telephony/reports';

/**
 * GET /api/telephony/reports/export?days=7&dataset=calls|callbacks|agents|summary
 * (admin+)
 *
 * Descarga el reporte en CSV para Excel (separador `;`, BOM UTF-8).
 * No necesita migración: usa las mismas tablas que el reporte en
 * pantalla (112 llamadas, 114/115 QA, 122 devoluciones).
 *
 * El tope es más alto que el del reporte visual (20 000 filas) porque
 * un export sí se espera completo; si se supera, se corta lo más
 * reciente y se avisa por cabecera (`X-Export-Truncated`) para que la
 * interfaz lo diga en vez de mentir con un archivo incompleto.
 */
const MAX_EXPORT_ROWS = 20_000;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const url = new URL(request.url);

    const rawDays = Number(url.searchParams.get('days') ?? 7);
    const days = Math.min(
      90,
      Math.max(1, Number.isFinite(rawDays) ? Math.floor(rawDays) : 7)
    );

    const rawDataset = url.searchParams.get('dataset') ?? 'calls';
    if (!isExportDataset(rawDataset)) {
      return NextResponse.json(
        { error: 'Conjunto inválido. Usa calls, callbacks, agents o summary.' },
        { status: 400 }
      );
    }
    const dataset = rawDataset;

    const now = Date.now();
    const todayKey = businessDayKey(new Date(now).toISOString());
    const firstKey = businessDayKey(
      new Date(now - (days - 1) * 86_400_000).toISOString()
    );
    // Caracas no tiene horario de verano: el inicio del día es -04:00.
    const from = new Date(`${firstKey}T00:00:00-04:00`).toISOString();

    const roster = (await loadTelephonyRoster(ctx.supabase, ctx.accountId)) ?? [];
    const rosterNames = new Map(
      roster.map((member) => [member.user_id, member.name])
    );
    const rosterForReport = roster.map((member) => ({
      user_id: member.user_id,
      name: member.name,
      role: member.role,
    }));

    /** Devoluciones del periodo, o `undefined` si falta la 122. */
    const loadCallbacks = async () => {
      const result = await ctx.supabase
        .from('callback_requests')
        .select(
          'status, reason, created_at, claimed_at, completed_at, completed_by, assigned_user_id, source_call_id'
        )
        .eq('account_id', ctx.accountId)
        .gte('created_at', from)
        .order('created_at', { ascending: false })
        .limit(MAX_EXPORT_ROWS);

      // Sin la 122 el resumen sale igual, sin la sección de devoluciones.
      if (result.error) return undefined;
      return aggregateCallbacks((result.data ?? []) as ReportCallbackRow[], {
        now,
        roster: rosterForReport,
      });
    };

    // ---- Agregados (agentes y resumen) -------------------------
    if (dataset === 'agents' || dataset === 'summary') {
      const { data, error } = await ctx.supabase
        .from('call_sessions')
        .select(
          'direction, status, started_at, answered_at, ended_at, duration_seconds, agent_user_id, disposition, recording_url, transcript_status, wrap_up_completed_at'
        )
        .eq('account_id', ctx.accountId)
        .gte('started_at', from)
        .order('started_at', { ascending: false })
        .limit(MAX_EXPORT_ROWS);

      if (error) throw error;

      const report = aggregateCalls(
        (data ?? []) as unknown as ReportCallRow[],
        { days, now, roster: rosterForReport }
      );

      const qaResult = await ctx.supabase
        .from('call_evaluations')
        .select('agent_user_id, score')
        .eq('account_id', ctx.accountId)
        .gte('created_at', from)
        .limit(MAX_EXPORT_ROWS);
      if (qaResult.error && !isMissingRelation(qaResult.error)) {
        throw qaResult.error;
      }
      const humanRows = ((qaResult.data ?? []) as QaScoreRow[]).map((row) => ({
        ...row,
        source: 'human' as const,
      }));

      const aiResult = await ctx.supabase
        .from('call_ai_evaluations')
        .select('agent_user_id, score')
        .eq('account_id', ctx.accountId)
        .gte('created_at', from)
        .limit(MAX_EXPORT_ROWS);
      if (aiResult.error && !isMissingRelation(aiResult.error)) {
        throw aiResult.error;
      }
      const aiRows = ((aiResult.data ?? []) as QaScoreRow[]).map((row) => ({
        ...row,
        source: 'ai' as const,
      }));

      const reportWithQa = mergeQaScores(report, [...humanRows, ...aiRows]);

      if (dataset === 'agents') {
        return csvResponse(buildAgentsCsv(reportWithQa), {
          fileName: exportFileName('agents', { days, day: todayKey }),
          rows: reportWithQa.agents.length,
          truncated: false,
        });
      }

      const callbacks = await loadCallbacks();

      return csvResponse(buildSummaryCsv(reportWithQa, callbacks), {
        fileName: exportFileName('summary', { days, day: todayKey }),
        rows: 0,
        truncated: false,
      });
    }

    // ---- Llamadas (una fila por sesión) ------------------------
    if (dataset === 'calls') {
      const { data, error } = await ctx.supabase
        .from('call_sessions')
        .select(
          'direction, status, started_at, answered_at, ended_at, duration_seconds, agent_user_id, disposition, recording_url, transcript_status, wrap_up_completed_at, from_number, to_number, contact:contacts(name)'
        )
        .eq('account_id', ctx.accountId)
        .gte('started_at', from)
        .order('started_at', { ascending: false })
        .limit(MAX_EXPORT_ROWS + 1);

      if (error) throw error;

      const all = (data ?? []) as unknown as Array<
        ReportCallRow & {
          from_number: string | null;
          to_number: string | null;
          contact?: { name: string | null } | null;
        }
      >;
      const truncated = all.length > MAX_EXPORT_ROWS;
      const visible = truncated ? all.slice(0, MAX_EXPORT_ROWS) : all;

      const rows: CallExportRow[] = visible.map((row) => ({
        ...row,
        contact_name: row.contact?.name ?? null,
        agent_name: row.agent_user_id
          ? rosterNames.get(row.agent_user_id) ?? 'Agente'
          : '',
      }));

      return csvResponse(buildCallsCsv(rows), {
        fileName: exportFileName('calls', { days, day: todayKey }),
        rows: rows.length,
        truncated,
      });
    }

    // ---- Devoluciones (una fila por solicitud) -----------------
    const callbacksResult = await ctx.supabase
      .from('callback_requests')
      .select(
        'status, reason, created_at, claimed_at, completed_at, completed_by, assigned_user_id, source_call_id, phone, note, call_session_id, contact:contacts(name)'
      )
      .eq('account_id', ctx.accountId)
      .gte('created_at', from)
      .order('created_at', { ascending: false })
      .limit(MAX_EXPORT_ROWS + 1);

    if (callbacksResult.error) {
      if (isMissingRelation(callbacksResult.error)) {
        return NextResponse.json(
          {
            error:
              'Falta aplicar la migración 122_callback_requests.sql para exportar devoluciones.',
          },
          { status: 400 }
        );
      }
      throw callbacksResult.error;
    }

    const all = (callbacksResult.data ?? []) as unknown as Array<
      ReportCallbackRow & {
        phone: string | null;
        note: string | null;
        call_session_id: string | null;
        contact?: { name: string | null } | null;
      }
    >;
    const truncated = all.length > MAX_EXPORT_ROWS;
    const visible = truncated ? all.slice(0, MAX_EXPORT_ROWS) : all;

    const rows: CallbackExportRow[] = visible.map((row) => ({
      ...row,
      contact_name: row.contact?.name ?? null,
      agent_name: row.assigned_user_id
        ? rosterNames.get(row.assigned_user_id) ?? 'Agente'
        : '',
      completed_by_name: row.completed_by
        ? rosterNames.get(row.completed_by) ?? 'Agente'
        : '',
    }));

    return csvResponse(buildCallbacksCsv(rows), {
      fileName: exportFileName('callbacks', { days, day: todayKey }),
      rows: rows.length,
      truncated,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function csvResponse(
  csv: string,
  options: { fileName: string; rows: number; truncated: boolean }
) {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${options.fileName}"`,
      'Cache-Control': 'no-store',
      'X-Export-Rows': String(options.rows),
      'X-Export-Truncated': options.truncated ? 'true' : 'false',
    },
  });
}

function isMissingRelation(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}
