// ============================================================
// Reportes de la operación de voz (WEM básico).
//
// Agrega `call_sessions` por día, hora, agente y disposición sin
// depender de una librería de BI. Los cálculos viven aquí (puros,
// con `now` inyectable) para poder probarlos sin red ni base.
//
// El "día" y la "hora" son los del negocio (America/Caracas), no los
// del servidor: una llamada de las 21:30 en Caracas no debe caer en
// el día siguiente porque el servidor esté en UTC.
// ============================================================

import type {
  CallDirection,
  CallDisposition,
  CallSessionStatus,
} from '@/types';
import { summarizeQa } from './qa';

export const BUSINESS_TIME_ZONE = 'America/Caracas';

export interface ReportCallRow {
  direction: CallDirection;
  status: CallSessionStatus;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  agent_user_id: string | null;
  disposition: CallDisposition | null;
  recording_url?: string | null;
  transcript_status?: string | null;
  wrap_up_completed_at?: string | null;
}

export interface ReportRosterMember {
  user_id: string;
  name: string;
  role: string;
}

export interface TelephonyReportTotals {
  total: number;
  inbound: number;
  outbound: number;
  answered: number;
  answeredInbound: number;
  missed: number;
  failed: number;
  cancelled: number;
  talkSeconds: number;
  avgHandleSeconds: number | null;
  /** Espera media antes de contestar una entrante (segundos). */
  avgWaitSeconds: number | null;
  /** Contestadas / entrantes (0–1). */
  answerRate: number | null;
  /** Entrantes perdidas / entrantes (0–1). */
  abandonmentRate: number | null;
  recorded: number;
  transcribed: number;
  /** Tiempo medio de cierre (colgada → disposición guardada). */
  avgWrapUpSeconds: number | null;
  /** 114 — evaluaciones de calidad del periodo. */
  qaCount?: number;
  avgQaScore?: number | null;
  /** Evaluaciones / llamadas contestadas (0–1). */
  qaCoverage?: number | null;
  /** 115 — evaluaciones automáticas con IA del periodo. */
  aiQaCount?: number;
  aiAvgQaScore?: number | null;
}

export interface TelephonyReportAgent {
  user_id: string;
  name: string;
  role: string;
  total: number;
  answered: number;
  talkSeconds: number;
  avgHandleSeconds: number | null;
  missed: number;
  /** 114 — promedio de QA (0–100) y cantidad evaluada. */
  qaScore?: number | null;
  qaCount?: number;
  /** 115 — promedio de QA con IA y cuántas evaluaciones generó. */
  aiQaScore?: number | null;
  aiQaCount?: number;
}

export interface TelephonyReportDay {
  date: string;
  total: number;
  answered: number;
  missed: number;
  talkSeconds: number;
}

export interface TelephonyReportHour {
  hour: number;
  total: number;
  answered: number;
}

export interface TelephonyReportDisposition {
  disposition: CallDisposition;
  count: number;
}

export interface TelephonyReport {
  days: number;
  from: string;
  to: string;
  timezone: string;
  totals: TelephonyReportTotals;
  agents: TelephonyReportAgent[];
  daysSeries: TelephonyReportDay[];
  hours: TelephonyReportHour[];
  dispositions: TelephonyReportDisposition[];
  /** La migración 112 no está aplicada: no hay llamadas que leer. */
  migrationMissing?: boolean;
}

const DAY_MS = 86_400_000;

/** Día del negocio en formato `YYYY-MM-DD`. */
export function businessDayKey(
  iso: string,
  timeZone: string = BUSINESS_TIME_ZONE
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  // en-CA produce YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Hora del negocio (0–23). */
export function businessHour(
  iso: string,
  timeZone: string = BUSINESS_TIME_ZONE
): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(date);
  const hour = Number(value);
  return Number.isFinite(hour) ? hour % 24 : 0;
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Serie de días vacía, del más antiguo al más reciente. */
export function emptyDaySeries(
  days: number,
  now: number,
  timeZone: string = BUSINESS_TIME_ZONE
): TelephonyReportDay[] {
  const count = Math.max(1, Math.min(Math.floor(days), 90));
  const series: TelephonyReportDay[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const key = businessDayKey(
      new Date(now - offset * DAY_MS).toISOString(),
      timeZone
    );
    series.push({ date: key, total: 0, answered: 0, missed: 0, talkSeconds: 0 });
  }
  return series;
}

/**
 * Agrega las filas de `call_sessions` en el reporte que consume la
 * página. Las filas fuera de la ventana se cuentan igual: la API ya
 * filtra por fecha.
 */
export function aggregateCalls(
  rows: ReportCallRow[],
  options: {
    days: number;
    now: number;
    roster?: ReportRosterMember[];
    timeZone?: string;
  }
): TelephonyReport {
  const { days, now } = options;
  const timeZone = options.timeZone ?? BUSINESS_TIME_ZONE;
  const daySeries = emptyDaySeries(days, now, timeZone);
  const dayIndex = new Map(daySeries.map((day) => [day.date, day]));
  const hours: TelephonyReportHour[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: 0,
    answered: 0,
  }));

  const agentMap = new Map<string, TelephonyReportAgent>();
  for (const member of options.roster ?? []) {
    agentMap.set(member.user_id, {
      user_id: member.user_id,
      name: member.name,
      role: member.role,
      total: 0,
      answered: 0,
      talkSeconds: 0,
      avgHandleSeconds: null,
      missed: 0,
    });
  }

  const totals: TelephonyReportTotals = {
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

  let waitSum = 0;
  let waitCount = 0;
  let handleSum = 0;
  let handleCount = 0;
  let wrapSum = 0;
  let wrapCount = 0;
  const dispositionCounts = new Map<CallDisposition, number>();

  for (const row of rows) {
    const answered = Boolean(row.answered_at);
    const duration = Math.max(0, row.duration_seconds ?? 0);

    totals.total += 1;
    if (row.direction === 'inbound') totals.inbound += 1;
    else totals.outbound += 1;
    if (answered) {
      totals.answered += 1;
      if (row.direction === 'inbound') totals.answeredInbound += 1;
      totals.talkSeconds += duration;
      handleSum += duration;
      handleCount += 1;
    }
    if (row.status === 'missed') totals.missed += 1;
    if (row.status === 'failed') totals.failed += 1;
    if (row.status === 'cancelled') totals.cancelled += 1;
    if (row.recording_url) totals.recorded += 1;
    if (row.transcript_status === 'done') totals.transcribed += 1;

    if (row.direction === 'inbound' && answered && row.answered_at) {
      const started = new Date(row.started_at).getTime();
      const answeredAt = new Date(row.answered_at).getTime();
      if (
        Number.isFinite(started) &&
        Number.isFinite(answeredAt) &&
        answeredAt >= started
      ) {
        waitSum += (answeredAt - started) / 1000;
        waitCount += 1;
      }
    }

    if (row.disposition) {
      dispositionCounts.set(
        row.disposition,
        (dispositionCounts.get(row.disposition) ?? 0) + 1
      );
      if (row.wrap_up_completed_at && row.ended_at) {
        const ended = new Date(row.ended_at).getTime();
        const saved = new Date(row.wrap_up_completed_at).getTime();
        if (Number.isFinite(ended) && Number.isFinite(saved) && saved >= ended) {
          wrapSum += (saved - ended) / 1000;
          wrapCount += 1;
        }
      }
    }

    const day = dayIndex.get(businessDayKey(row.started_at, timeZone));
    if (day) {
      day.total += 1;
      if (answered) day.answered += 1;
      if (row.status === 'missed') day.missed += 1;
      day.talkSeconds += duration;
    }

    const hour = businessHour(row.started_at, timeZone);
    hours[hour].total += 1;
    if (answered) hours[hour].answered += 1;

    if (row.agent_user_id) {
      let agent = agentMap.get(row.agent_user_id);
      if (!agent) {
        agent = {
          user_id: row.agent_user_id,
          name: 'Agente',
          role: 'agent',
          total: 0,
          answered: 0,
          talkSeconds: 0,
          avgHandleSeconds: null,
          missed: 0,
        };
        agentMap.set(row.agent_user_id, agent);
      }
      agent.total += 1;
      if (answered) {
        agent.answered += 1;
        agent.talkSeconds += duration;
      }
      if (row.status === 'missed') agent.missed += 1;
    }
  }

  totals.avgHandleSeconds = handleCount
    ? Math.round(handleSum / handleCount)
    : null;
  totals.avgWaitSeconds = waitCount ? round(waitSum / waitCount, 1) : null;
  totals.avgWrapUpSeconds = wrapCount ? round(wrapSum / wrapCount, 1) : null;
  totals.answerRate = totals.inbound
    ? round(totals.answeredInbound / totals.inbound, 3)
    : null;
  totals.abandonmentRate = totals.inbound
    ? round(totals.missed / totals.inbound, 3)
    : null;

  const agents = [...agentMap.values()]
    .map((agent) => ({
      ...agent,
      avgHandleSeconds: agent.answered
        ? Math.round(agent.talkSeconds / agent.answered)
        : null,
    }))
    .sort(
      (a, b) =>
        b.answered - a.answered ||
        b.talkSeconds - a.talkSeconds ||
        a.name.localeCompare(b.name)
    );

  const dispositions = [...dispositionCounts.entries()]
    .map(([disposition, count]) => ({ disposition, count }))
    .sort((a, b) => b.count - a.count);

  const from = daySeries[0]?.date ?? businessDayKey(new Date(now).toISOString());
  const to =
    daySeries[daySeries.length - 1]?.date ??
    businessDayKey(new Date(now).toISOString());

  return {
    days: daySeries.length,
    from,
    to,
    timezone: timeZone,
    totals,
    agents,
    daysSeries: daySeries,
    hours,
    dispositions,
  };
}

export interface QaScoreRow {
  agent_user_id: string | null;
  score: number;
  /** 114 — nota humana del supervisor; 115 — nota automática con IA. */
  source?: 'human' | 'ai';
  call_id?: string | null;
}

/**
 * Añade las notas de QA al reporte. Se hace aparte de `aggregateCalls`
 * porque las evaluaciones viven en otra tabla y pueden llegar después
 * de la llamada; el reporte sigue siendo puro y testeable.
 */
export function mergeQaScores(
  report: TelephonyReport,
  rows: QaScoreRow[]
): TelephonyReport {
  const humanRows = rows.filter((row) => !row.source || row.source === 'human');
  const aiRows = rows.filter((row) => row.source === 'ai');

  const byAgent = new Map<string, number[]>();
  const all: number[] = [];

  for (const row of humanRows) {
    if (!Number.isFinite(row.score)) continue;
    all.push(row.score);
    if (row.agent_user_id) {
      const list = byAgent.get(row.agent_user_id) ?? [];
      list.push(row.score);
      byAgent.set(row.agent_user_id, list);
    }
  }

  const summary = summarizeQa(all, report.totals.answered);

  // QA automática con IA (115): promedio por agente y global. Se
  // calcula aparte de la humana para poder compararlas después.
  const aiByAgent = new Map<string, number[]>();
  const aiAll: number[] = [];
  for (const row of aiRows) {
    if (!Number.isFinite(row.score) || row.score < 0 || row.score > 100) continue;
    aiAll.push(row.score);
    if (row.agent_user_id) {
      const list = aiByAgent.get(row.agent_user_id) ?? [];
      list.push(row.score);
      aiByAgent.set(row.agent_user_id, list);
    }
  }

  const aiAverage =
    aiAll.length > 0 ? aiAll.reduce((sum, value) => sum + value, 0) / aiAll.length : null;

  const agents = report.agents.map((agent) => {
    const scores = byAgent.get(agent.user_id) ?? [];
    const aiScores = aiByAgent.get(agent.user_id) ?? [];
    const mean = (list: number[]) =>
      list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
    return {
      ...agent,
      qaCount: scores.length,
      qaScore: scores.length ? Math.round(mean(scores) ?? 0) : null,
      aiQaCount: aiScores.length,
      aiQaScore: aiScores.length ? Math.round(mean(aiScores) ?? 0) : null,
    };
  });

  return {
    ...report,
    agents,
    totals: {
      ...report.totals,
      qaCount: summary.count,
      avgQaScore: summary.average,
      qaCoverage: summary.coverage,
      aiQaCount: aiAll.length,
      aiAvgQaScore: aiAverage == null ? null : Math.round(aiAverage),
    },
  };
}
