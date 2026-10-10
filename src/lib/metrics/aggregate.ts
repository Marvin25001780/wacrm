// ============================================================
// Agregación de métricas de mensajería — módulo Métricas.
//
// Función PURA (sin Supabase): recibe las filas de `messages` de un
// período y los perfiles de la cuenta y devuelve los KPIs de
// enviados / recibidos / respondidos, el desglose por canal, el
// ranking por agente y la serie diaria.
//
// Definiciones:
//   • enviado   → mensaje saliente (sender_type = agent | bot)
//   • recibido  → mensaje entrante (sender_type = customer)
//   • respondido→ mensaje entrante al que le siguió, en la misma
//                 conversación y de forma cronológica, al menos un
//                 saliente. La tasa de respuesta = respondidos/recibidos.
//   • tiempo de primera respuesta → minutos entre un entrante sin
//                 responder y el primer saliente que lo contesta.
//
// La atribución por agente usa `messages.sender_id` (auth.users.id)
// cruzándolo con `profiles.user_id` (o `profiles.id` como respaldo).
// ============================================================

import { lastNDayKeys, localDayKey } from "@/lib/dashboard/date-utils";

// ------------------------------------------------------------
// Entradas
// ------------------------------------------------------------
export interface MessagingMessageRow {
  conversation_id: string;
  sender_type: string;
  sender_id?: string | null;
  channel?: string | null;
  created_at: string;
}

export interface MessagingProfile {
  id: string;
  user_id?: string | null;
  full_name?: string | null;
  email?: string | null;
}

// ------------------------------------------------------------
// Salidas
// ------------------------------------------------------------
export interface ChannelMetrics {
  channel: string;
  sent: number;
  received: number;
  /** Entrantes de este canal que recibieron respuesta. */
  replied: number;
  responseRate: number;
  avgFirstResponseMin: number | null;
}

export interface AgentMessagingMetrics {
  profileId: string;
  userId: string | null;
  fullName: string;
  email: string;
  /** Mensajes salientes atribuidos al agente. */
  sent: number;
  /** Conversaciones distintas en las que participó. */
  conversations: number;
}

export interface MessagingTotals {
  sent: number;
  received: number;
  replied: number;
  responseRate: number;
  avgFirstResponseMin: number | null;
  activeAgents: number;
}

export interface MessagingSeriesPoint {
  day: string;
  incoming: number;
  outgoing: number;
}

export interface MessagingResult {
  totals: MessagingTotals;
  channels: ChannelMetrics[];
  agents: AgentMessagingMetrics[];
  series: MessagingSeriesPoint[];
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
const DEFAULT_CHANNEL = "whatsapp";

function normalizeChannel(channel?: string | null): string {
  return channel && channel.length > 0 ? channel : DEFAULT_CHANNEL;
}

interface ChannelAcc {
  sent: number;
  received: number;
  replied: number;
  responseSum: number;
  responseCount: number;
}

function emptyChannelAcc(): ChannelAcc {
  return { sent: 0, received: 0, replied: 0, responseSum: 0, responseCount: 0 };
}

/**
 * Agrega las filas de mensajes de un período.
 *
 * @param rows     filas de `messages` (ya filtradas por período y cuenta)
 * @param profiles perfiles de la cuenta (para atribuir `sender_id`)
 * @param days     número de días para la serie (7 / 30 / 90)
 */
export function aggregateMessaging(
  rows: MessagingMessageRow[],
  profiles: MessagingProfile[],
  days: number
): MessagingResult {
  // Índice de perfiles por `id` y por `user_id` (los mensajes guardan
  // el auth.users.id, pero toleramos cualquiera de los dos).
  const profileById = new Map<string, MessagingProfile>();
  for (const p of profiles) {
    profileById.set(p.id, p);
    if (p.user_id) profileById.set(p.user_id, p);
  }

  const channelAgg = new Map<string, ChannelAcc>();
  const agentAgg = new Map<
    string,
    { profile: MessagingProfile; sent: number; conversations: Set<string> }
  >();
  const seriesMap = new Map<string, { incoming: number; outgoing: number }>();
  const byConversation = new Map<string, MessagingMessageRow[]>();

  for (const r of rows) {
    const list = byConversation.get(r.conversation_id);
    if (list) list.push(r);
    else byConversation.set(r.conversation_id, [r]);

    const key = localDayKey(r.created_at);
    const point = seriesMap.get(key) ?? { incoming: 0, outgoing: 0 };
    if (r.sender_type === "customer") point.incoming += 1;
    else point.outgoing += 1;
    seriesMap.set(key, point);
  }

  let totalSent = 0;
  let totalReceived = 0;
  let totalReplied = 0;
  let responseSum = 0;
  let responseCount = 0;

  for (const msgs of byConversation.values()) {
    // Orden cronológico: la detección de respuesta depende de ello.
    msgs.sort((a, b) => a.created_at.localeCompare(b.created_at));

    let pending: MessagingMessageRow | null = null;

    for (const m of msgs) {
      const channel = normalizeChannel(m.channel);
      const acc = channelAgg.get(channel) ?? emptyChannelAcc();
      channelAgg.set(channel, acc);

      if (m.sender_type === "customer") {
        acc.received += 1;
        totalReceived += 1;
        if (!pending) pending = m;
        continue;
      }

      // Saliente (agente o bot).
      acc.sent += 1;
      totalSent += 1;

      if (m.sender_type === "agent" && m.sender_id) {
        const profile = profileById.get(m.sender_id);
        if (profile) {
          const agg =
            agentAgg.get(profile.id) ??
            { profile, sent: 0, conversations: new Set<string>() };
          agg.sent += 1;
          agg.conversations.add(m.conversation_id);
          agentAgg.set(profile.id, agg);
        }
      }

      if (pending) {
        // La respuesta se atribuye al canal del mensaje entrante.
        const pendingChannel = normalizeChannel(pending.channel);
        const pendingAcc =
          channelAgg.get(pendingChannel) ?? emptyChannelAcc();
        channelAgg.set(pendingChannel, pendingAcc);

        pendingAcc.replied += 1;
        totalReplied += 1;

        const deltaMin =
          (new Date(m.created_at).getTime() -
            new Date(pending.created_at).getTime()) /
          60000;
        if (Number.isFinite(deltaMin) && deltaMin >= 0) {
          pendingAcc.responseSum += deltaMin;
          pendingAcc.responseCount += 1;
          responseSum += deltaMin;
          responseCount += 1;
        }
        pending = null;
      }
    }
  }

  const channels: ChannelMetrics[] = [...channelAgg.entries()]
    .map(([channel, a]) => ({
      channel,
      sent: a.sent,
      received: a.received,
      replied: a.replied,
      responseRate: a.received > 0 ? a.replied / a.received : 0,
      avgFirstResponseMin:
        a.responseCount > 0 ? a.responseSum / a.responseCount : null,
    }))
    .sort(
      (a, b) =>
        b.sent + b.received - (a.sent + a.received) ||
        a.channel.localeCompare(b.channel)
    );

  const agents: AgentMessagingMetrics[] = [...agentAgg.values()]
    .map((a) => ({
      profileId: a.profile.id,
      userId: a.profile.user_id ?? null,
      fullName:
        (a.profile.full_name && a.profile.full_name.trim()) ||
        a.profile.email ||
        "Sin nombre",
      email: a.profile.email ?? "",
      sent: a.sent,
      conversations: a.conversations.size,
    }))
    .sort((a, b) => b.sent - a.sent || a.fullName.localeCompare(b.fullName));

  const series: MessagingSeriesPoint[] = lastNDayKeys(days).map((day) => ({
    day,
    ...(seriesMap.get(day) ?? { incoming: 0, outgoing: 0 }),
  }));

  return {
    totals: {
      sent: totalSent,
      received: totalReceived,
      replied: totalReplied,
      responseRate: totalReceived > 0 ? totalReplied / totalReceived : 0,
      avgFirstResponseMin:
        responseCount > 0 ? responseSum / responseCount : null,
      activeAgents: agentAgg.size,
    },
    channels,
    agents,
    series,
  };
}

// ------------------------------------------------------------
// Utilidades de formato/periodo compartidas con la página
// ------------------------------------------------------------
export type MetricPeriodKey = "7" | "30" | "90";

export const METRIC_PERIODS: Array<{
  key: MetricPeriodKey;
  label: string;
  days: number;
}> = [
  { key: "7", label: "7 días", days: 7 },
  { key: "30", label: "30 días", days: 30 },
  { key: "90", label: "90 días", days: 90 },
];

/** Inicio (ISO) del período pedido, o null para "todo". */
export function periodStartIso(key: MetricPeriodKey): string {
  const period = METRIC_PERIODS.find((p) => p.key === key);
  const days = period?.days ?? 30;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start.toISOString();
}

/** Da formato a minutos como "12 min", "3 h 5 min" o "2 d 4 h". */
export function formatDuration(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round(minutes - h * 60);
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h > 0 ? `${d} d ${h} h` : `${d} d`;
}
