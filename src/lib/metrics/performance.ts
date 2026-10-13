// ============================================================
// Agregación de la sección RENDIMIENTO — módulo de Métricas.
//
// Función PURA. Recibe las filas del período y devuelve:
//   • KPIs de tiempos (1ª respuesta, respuesta, cierre) y CSAT
//   • serie diaria de tiempos
//   • distribución de satisfacción (satisfecho / neutral / insatisfecho)
//   • rendimiento por AGENTE y por EQUIPO
//   • registros de estado de los agentes (con duración)
//
// Definiciones:
//   • 1ª respuesta → primera contestación de un agente tras el primer
//                    mensaje entrante del contacto (minutos).
//   • respuesta   → media de todas las contestaciones (entrante →
//                    siguiente saliente).
//   • cierre      → created_at → closed_at de la conversación.
//   • CSAT        → score 1..5; satisfecho ≥4, neutral =3, insatisfecho ≤2.
// ============================================================

import { localDayKey } from "@/lib/dashboard/date-utils";

export interface PerfConversationRow {
  id: string;
  assigned_agent_id: string | null;
  channel: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface PerfMessageRow {
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  created_at: string;
}

export interface PerfProfileRow {
  /** auth.users.id (mismo espacio que sender_id / assigned_agent_id). */
  userId: string | null;
  id: string;
  name: string;
}

export interface PerfTeamRow {
  id: string;
  name: string;
}

export interface PerfTeamMemberRow {
  teamId: string;
  profileId: string;
}

export interface CsatRow {
  conversation_id: string | null;
  agent_id: string | null;
  score: number;
  comment: string | null;
  created_at: string;
}

export interface StatusEventRow {
  user_id: string;
  status: string;
  created_at: string;
}

export interface PerformanceSeriesPoint {
  day: string;
  firstResponse: number;
  response: number;
  close: number;
}

export interface AgentPerformance {
  profileId: string;
  name: string;
  conversations: number;
  created: number;
  messagesSent: number;
  firstResponseMin: number | null;
  closeMin: number | null;
  csatAvg: number | null;
  csatCount: number;
}

export interface TeamPerformance {
  teamId: string;
  name: string;
  conversations: number;
  created: number;
  messagesSent: number;
  firstResponseMin: number | null;
  closeMin: number | null;
  csatAvg: number | null;
  csatCount: number;
}

export interface StatusEventDisplay {
  userId: string;
  name: string;
  status: string;
  startedAt: string;
  durationMin: number | null;
}

export interface PerformanceResult {
  totals: {
    firstResponseMin: number | null;
    responseMin: number | null;
    closeMin: number | null;
    respondedConversations: number;
    closedConversations: number;
    csatAvg: number | null;
    csatCount: number;
  };
  series: PerformanceSeriesPoint[];
  csat: { satisfied: number; neutral: number; unsatisfied: number };
  agents: AgentPerformance[];
  teams: TeamPerformance[];
  statusEvents: StatusEventDisplay[];
}

interface Acc {
  sum: number;
  count: number;
}

interface AgentAgg {
  first: Acc;
  close: Acc;
  csat: Acc;
  conversations: number;
  created: number;
  messagesSent: number;
  csatCount: number;
}

const MINUTE = 60_000;
/** Tope defensivo: ignoramos gaps absurdos (>30 días). */
const MAX_REASONABLE_MINUTES = 60 * 24 * 30;

function newAcc(): Acc {
  return { sum: 0, count: 0 };
}

function addTo(a: Acc, value: number): void {
  if (!Number.isFinite(value)) return;
  a.sum += value;
  a.count += 1;
}

function meanOf(a: Acc): number | null {
  return a.count > 0 ? a.sum / a.count : null;
}

function minutesBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / MINUTE;
}

export function aggregatePerformance(
  conversations: PerfConversationRow[],
  messages: PerfMessageRow[],
  profiles: PerfProfileRow[],
  teams: PerfTeamRow[],
  teamMembers: PerfTeamMemberRow[],
  csat: CsatRow[],
  statusEvents: StatusEventRow[],
  dayKeys: string[]
): PerformanceResult {
  const inRange = new Set(dayKeys);

  // Lookup de perfiles por `profiles.id` Y por `user_id`.
  const profileByAnyId = new Map<string, PerfProfileRow>();
  for (const p of profiles) {
    if (p.userId) profileByAnyId.set(p.userId, p);
    profileByAnyId.set(p.id, p);
  }

  // Mensajes agrupados por conversación y ordenados ascendentemente.
  const msgsByConv = new Map<string, PerfMessageRow[]>();
  for (const m of messages) {
    const list = msgsByConv.get(m.conversation_id);
    if (list) list.push(m);
    else msgsByConv.set(m.conversation_id, [m]);
  }
  for (const list of msgsByConv.values()) {
    list.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }

  const seriesFirst = new Map<string, Acc>();
  const seriesResp = new Map<string, Acc>();
  const seriesClose = new Map<string, Acc>();
  const bump = (map: Map<string, Acc>, day: string, value: number) => {
    let a = map.get(day);
    if (!a) {
      a = newAcc();
      map.set(day, a);
    }
    addTo(a, value);
  };

  const globalFirst = newAcc();
  const globalResp = newAcc();
  const globalClose = newAcc();

  const agentAgg = new Map<string, AgentAgg>();
  const agentFor = (profileId: string): AgentAgg => {
    let a = agentAgg.get(profileId);
    if (!a) {
      a = {
        first: newAcc(),
        close: newAcc(),
        csat: newAcc(),
        conversations: 0,
        created: 0,
        messagesSent: 0,
        csatCount: 0,
      };
      agentAgg.set(profileId, a);
    }
    return a;
  };

  // ---- Conversaciones: tiempos y conteos ----------------------
  for (const c of conversations) {
    const agentProfileId = c.assigned_agent_id
      ? profileByAnyId.get(c.assigned_agent_id)?.id ?? null
      : null;
    const agent = agentProfileId ? agentFor(agentProfileId) : null;

    if (agent) agent.conversations += 1;
    if (agent && inRange.has(localDayKey(c.created_at))) agent.created += 1;

    const list = msgsByConv.get(c.id);
    if (list) {
      let pendingSince: string | null = null;
      let firstSeen = false;
      for (const m of list) {
        if (m.sender_type === "customer") {
          if (pendingSince === null) pendingSince = m.created_at;
          continue;
        }
        if (pendingSince === null) continue;
        const delta = minutesBetween(pendingSince, m.created_at);
        pendingSince = null;
        if (delta < 0 || delta > MAX_REASONABLE_MINUTES) continue;
        const day = localDayKey(m.created_at);
        if (inRange.has(day)) {
          bump(seriesResp, day, delta);
          addTo(globalResp, delta);
        }
        if (!firstSeen) {
          firstSeen = true;
          if (inRange.has(day)) {
            bump(seriesFirst, day, delta);
            addTo(globalFirst, delta);
          }
          if (agent) addTo(agent.first, delta);
        }
      }
    }

    if (c.closed_at) {
      const delta = minutesBetween(c.created_at, c.closed_at);
      if (delta >= 0 && delta <= MAX_REASONABLE_MINUTES) {
        const day = localDayKey(c.closed_at);
        if (inRange.has(day)) {
          bump(seriesClose, day, delta);
          addTo(globalClose, delta);
        }
        if (agent) addTo(agent.close, delta);
      }
    }
  }

  // ---- Mensajes salientes por agente --------------------------
  for (const m of messages) {
    if (m.sender_type === "customer" || !m.sender_id) continue;
    const p = profileByAnyId.get(m.sender_id);
    if (p) agentFor(p.id).messagesSent += 1;
  }

  // ---- CSAT ---------------------------------------------------
  const csatGlobal = newAcc();
  let satisfied = 0;
  let neutral = 0;
  let unsatisfied = 0;
  for (const r of csat) {
    addTo(csatGlobal, r.score);
    if (r.score >= 4) satisfied += 1;
    else if (r.score === 3) neutral += 1;
    else unsatisfied += 1;
    if (r.agent_id) {
      const p = profileByAnyId.get(r.agent_id);
      if (p) {
        const a = agentFor(p.id);
        addTo(a.csat, r.score);
        a.csatCount += 1;
      }
    }
  }

  // ---- Tabla de agentes ---------------------------------------
  const agents: AgentPerformance[] = [];
  for (const [profileId, a] of agentAgg) {
    if (
      a.conversations === 0 &&
      a.messagesSent === 0 &&
      a.csatCount === 0
    ) {
      continue;
    }
    agents.push({
      profileId,
      name: profileByAnyId.get(profileId)?.name ?? "Agente",
      conversations: a.conversations,
      created: a.created,
      messagesSent: a.messagesSent,
      firstResponseMin: meanOf(a.first),
      closeMin: meanOf(a.close),
      csatAvg: meanOf(a.csat),
      csatCount: a.csatCount,
    });
  }
  agents.sort(
    (a, b) =>
      b.conversations - a.conversations || b.messagesSent - a.messagesSent
  );

  // ---- Tabla de equipos ---------------------------------------
  const teamsList: TeamPerformance[] = teams.map((t) => {
    let conversations = 0;
    let created = 0;
    let messagesSent = 0;
    let csatCount = 0;
    const first = newAcc();
    const close = newAcc();
    const cs = newAcc();
    for (const m of teamMembers) {
      if (m.teamId !== t.id) continue;
      const a = agentAgg.get(m.profileId);
      if (!a) continue;
      conversations += a.conversations;
      created += a.created;
      messagesSent += a.messagesSent;
      first.sum += a.first.sum;
      first.count += a.first.count;
      close.sum += a.close.sum;
      close.count += a.close.count;
      cs.sum += a.csat.sum;
      cs.count += a.csat.count;
      csatCount += a.csatCount;
    }
    return {
      teamId: t.id,
      name: t.name,
      conversations,
      created,
      messagesSent,
      firstResponseMin: meanOf(first),
      closeMin: meanOf(close),
      csatAvg: meanOf(cs),
      csatCount,
    };
  });

  // ---- Registros de estado ------------------------------------
  const sortedEvents = [...statusEvents].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const statusEventsDisplay: StatusEventDisplay[] = sortedEvents
    .map((e, i) => {
      const next = sortedEvents[i + 1];
      const durationMin =
        next && next.user_id === e.user_id
          ? minutesBetween(e.created_at, next.created_at)
          : null;
      return {
        userId: e.user_id,
        name: profileByAnyId.get(e.user_id)?.name ?? "Agente",
        status: e.status,
        startedAt: e.created_at,
        durationMin,
      };
    })
    .reverse();

  // ---- Serie diaria -------------------------------------------
  const series: PerformanceSeriesPoint[] = dayKeys.map((day) => ({
    day,
    firstResponse: Math.round(meanOf(seriesFirst.get(day) ?? newAcc()) ?? 0),
    response: Math.round(meanOf(seriesResp.get(day) ?? newAcc()) ?? 0),
    close: Math.round(meanOf(seriesClose.get(day) ?? newAcc()) ?? 0),
  }));

  return {
    totals: {
      firstResponseMin: meanOf(globalFirst),
      responseMin: meanOf(globalResp),
      closeMin: meanOf(globalClose),
      respondedConversations: globalFirst.count,
      closedConversations: globalClose.count,
      csatAvg: meanOf(csatGlobal),
      csatCount: csatGlobal.count,
    },
    series,
    csat: { satisfied, neutral, unsatisfied },
    agents,
    teams: teamsList,
    statusEvents: statusEventsDisplay,
  };
}
