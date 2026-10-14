// ============================================================
// Agregación de la sección LLAMADAS — módulo de Métricas.
//
// Función PURA. Recibe las actividades con type = 'call' del período
// y devuelve:
//   • KPIs (volumen, completadas, duración media, tasa de cierre,
//     tasa de respuesta, entrantes/salientes)
//   • serie diaria de llamadas
//   • mapa de calor 7×24 (día de la semana × hora) de "horas pico"
//   • rendimiento por AGENTE y por EQUIPO
//   • registro de llamadas
//
// Definiciones:
//   • fecha de la llamada → due_at (programada) o created_at.
//   • completada          → status = 'done'.
//   • contestada          → call_result = 'answered'.
//   • no efectiva         → no_answer + busy + failed.
//   • duración media      → media de duration_minutes con valor.
// ============================================================

import { localDayKey, mondayIndex } from "@/lib/dashboard/date-utils";

export interface CallRow {
  id: string;
  subject: string;
  assigned_to: string | null;
  duration_minutes: number | null;
  status: string;
  outcome: string | null;
  call_direction: string | null;
  call_result: string | null;
  due_at: string | null;
  completed_at: string | null;
  contact_id: string | null;
  created_at: string;
}

export interface CallProfileRow {
  /** auth.users.id (por si `assigned_to` guardara el user id). */
  userId: string | null;
  id: string;
  name: string;
}

export interface CallTeamRow {
  id: string;
  name: string;
}

export interface CallTeamMemberRow {
  teamId: string;
  profileId: string;
}

export interface CallContactRow {
  id: string;
  name: string | null;
}

export interface CallSeriesPoint {
  day: string;
  total: number;
  completed: number;
  inbound: number;
  outbound: number;
}

export interface CallTableRow {
  key: string;
  name: string;
  total: number;
  completed: number;
  pending: number;
  cancelled: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  avgDurationMin: number | null;
  completionRate: number | null;
}

export interface CallLogEntry {
  id: string;
  at: string;
  subject: string;
  contactName: string;
  agentName: string;
  direction: string | null;
  result: string | null;
  durationMin: number | null;
  status: string;
}

export interface CallsResult {
  totals: {
    total: number;
    completed: number;
    pending: number;
    cancelled: number;
    inbound: number;
    outbound: number;
    answered: number;
    missed: number;
    avgDurationMin: number | null;
    completionRate: number | null;
    answerRate: number | null;
  };
  results: {
    answered: number;
    noAnswer: number;
    busy: number;
    failed: number;
    voicemail: number;
    unknown: number;
  };
  series: CallSeriesPoint[];
  heatmap: number[][];
  agents: CallTableRow[];
  teams: CallTableRow[];
  log: CallLogEntry[];
}

interface Acc {
  total: number;
  completed: number;
  pending: number;
  cancelled: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  durationSum: number;
  durationCount: number;
}

const UNASSIGNED = "__unassigned__";
const NO_TEAM = "__no_team__";

function newAcc(): Acc {
  return {
    total: 0,
    completed: 0,
    pending: 0,
    cancelled: 0,
    inbound: 0,
    outbound: 0,
    answered: 0,
    missed: 0,
    durationSum: 0,
    durationCount: 0,
  };
}

function isMissed(result: string | null): boolean {
  return result === "no_answer" || result === "busy" || result === "failed";
}

function bump(a: Acc, r: CallRow): void {
  a.total += 1;
  if (r.status === "done") a.completed += 1;
  else if (r.status === "cancelled") a.cancelled += 1;
  else a.pending += 1;

  if (r.call_direction === "inbound") a.inbound += 1;
  else if (r.call_direction === "outbound") a.outbound += 1;

  if (r.call_result === "answered") a.answered += 1;
  else if (isMissed(r.call_result)) a.missed += 1;

  if (r.duration_minutes != null && Number.isFinite(r.duration_minutes)) {
    a.durationSum += r.duration_minutes;
    a.durationCount += 1;
  }
}

function meanDuration(a: Acc): number | null {
  return a.durationCount > 0 ? a.durationSum / a.durationCount : null;
}

function toRow(key: string, name: string, a: Acc): CallTableRow {
  return {
    key,
    name,
    total: a.total,
    completed: a.completed,
    pending: a.pending,
    cancelled: a.cancelled,
    inbound: a.inbound,
    outbound: a.outbound,
    answered: a.answered,
    missed: a.missed,
    avgDurationMin: meanDuration(a),
    completionRate: a.total > 0 ? a.completed / a.total : null,
  };
}

/** Fecha de la llamada: programada si existe; si no, de registro. */
function callIso(r: CallRow): string {
  return r.due_at ?? r.created_at;
}

export function aggregateCalls(
  rows: CallRow[],
  profiles: CallProfileRow[],
  teams: CallTeamRow[],
  teamMembers: CallTeamMemberRow[],
  contacts: CallContactRow[],
  dayKeys: string[]
): CallsResult {
  const inRange = new Set(dayKeys);

  // Lookup de perfiles por `profiles.id` y por `user_id`.
  const profileByAnyId = new Map<string, CallProfileRow>();
  for (const p of profiles) {
    if (p.userId) profileByAnyId.set(p.userId, p);
    profileByAnyId.set(p.id, p);
  }

  const contactName = new Map<string, string>();
  for (const c of contacts) contactName.set(c.id, c.name ?? "");

  const teamsByProfile = new Map<string, string[]>();
  for (const m of teamMembers) {
    const arr = teamsByProfile.get(m.profileId);
    if (arr) arr.push(m.teamId);
    else teamsByProfile.set(m.profileId, [m.teamId]);
  }
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

  const seriesMap = new Map<string, CallSeriesPoint>();
  for (const day of dayKeys) {
    seriesMap.set(day, {
      day,
      total: 0,
      completed: 0,
      inbound: 0,
      outbound: 0,
    });
  }

  const heatmap: number[][] = Array.from({ length: 7 }, () =>
    new Array<number>(24).fill(0)
  );

  const results = {
    answered: 0,
    noAnswer: 0,
    busy: 0,
    failed: 0,
    voicemail: 0,
    unknown: 0,
  };

  const global = newAcc();
  const agentAgg = new Map<string, Acc>();
  const teamAgg = new Map<string, Acc>();
  const noTeam = newAcc();

  for (const r of rows) {
    const iso = callIso(r);
    const day = localDayKey(iso);
    // La consulta ya acota el período; el guard evita sorpresas de zona.
    if (!inRange.has(day)) continue;

    bump(global, r);

    // Serie diaria.
    const point = seriesMap.get(day);
    if (point) {
      point.total += 1;
      if (r.status === "done") point.completed += 1;
      if (r.call_direction === "inbound") point.inbound += 1;
      else if (r.call_direction === "outbound") point.outbound += 1;
    }

    // Mapa de calor (hora local del evento).
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      const dow = mondayIndex(d);
      heatmap[dow][d.getHours()] += 1;
    }

    // Resultados.
    switch (r.call_result) {
      case "answered":
        results.answered += 1;
        break;
      case "no_answer":
        results.noAnswer += 1;
        break;
      case "busy":
        results.busy += 1;
        break;
      case "failed":
        results.failed += 1;
        break;
      case "voicemail":
        results.voicemail += 1;
        break;
      default:
        results.unknown += 1;
    }

    // Agente (por profiles.id, con respaldo por user_id).
    const pid = r.assigned_to
      ? profileByAnyId.get(r.assigned_to)?.id ?? r.assigned_to
      : UNASSIGNED;
    let aa = agentAgg.get(pid);
    if (!aa) {
      aa = newAcc();
      agentAgg.set(pid, aa);
    }
    bump(aa, r);

    // Equipo(s) del agente; si no tiene, "Sin equipo".
    const teamIds = pid !== UNASSIGNED ? teamsByProfile.get(pid) : undefined;
    if (teamIds && teamIds.length > 0) {
      for (const tid of teamIds) {
        let ta = teamAgg.get(tid);
        if (!ta) {
          ta = newAcc();
          teamAgg.set(tid, ta);
        }
        bump(ta, r);
      }
    } else {
      bump(noTeam, r);
    }
  }

  // ---- Tabla de agentes ---------------------------------------
  const agents: CallTableRow[] = [...agentAgg.entries()].map(([key, a]) =>
    toRow(
      key,
      key === UNASSIGNED
        ? "Sin asignar"
        : profileByAnyId.get(key)?.name ?? "Agente",
      a
    )
  );
  agents.sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name, "es")
  );

  // ---- Tabla de equipos ---------------------------------------
  const teamRows: CallTableRow[] = [...teamAgg.entries()].map(([id, a]) =>
    toRow(id, teamNameById.get(id) ?? "Equipo", a)
  );
  teamRows.sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name, "es")
  );
  if (noTeam.total > 0) teamRows.push(toRow(NO_TEAM, "Sin equipo", noTeam));

  // ---- Serie diaria -------------------------------------------
  const series: CallSeriesPoint[] = dayKeys.map(
    (day) =>
      seriesMap.get(day) ?? {
        day,
        total: 0,
        completed: 0,
        inbound: 0,
        outbound: 0,
      }
  );

  // ---- Registro -----------------------------------------------
  const log: CallLogEntry[] = [...rows]
    .sort(
      (a, b) => new Date(callIso(b)).getTime() - new Date(callIso(a)).getTime()
    )
    .map((r) => ({
      id: r.id,
      at: callIso(r),
      subject: r.subject,
      contactName: r.contact_id ? contactName.get(r.contact_id) ?? "" : "",
      agentName:
        (r.assigned_to ? profileByAnyId.get(r.assigned_to)?.name : null) ??
        "Sin asignar",
      direction: r.call_direction,
      result: r.call_result,
      durationMin: r.duration_minutes,
      status: r.status,
    }));

  const answeredAndMissed = global.answered + global.missed;

  return {
    totals: {
      total: global.total,
      completed: global.completed,
      pending: global.pending,
      cancelled: global.cancelled,
      inbound: global.inbound,
      outbound: global.outbound,
      answered: global.answered,
      missed: global.missed,
      avgDurationMin: meanDuration(global),
      completionRate: global.total > 0 ? global.completed / global.total : null,
      answerRate:
        answeredAndMissed > 0 ? global.answered / answeredAndMissed : null,
    },
    results,
    series,
    heatmap,
    agents,
    teams: teamRows,
    log,
  };
}
