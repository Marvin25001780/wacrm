// ============================================================
// Agregación de la sección CONVERSACIONES — módulo de Métricas.
//
// Función PURA (sin Supabase): recibe las filas de `conversations`,
// `messages` y `conversation_tags` de un período (ya filtradas por
// cuenta/agente/equipo/canal) y devuelve:
//   • KPIs (activas, nuevas, enviados, recibidos)
//   • serie diaria (activas / nuevas / enviados / recibidos)
//   • dos mapas de calor 7×24 de horas pico (entrantes y salientes)
//   • ranking de etiquetas de conversación
//   • motivos de cierre
//   • tabla por canal
//
// Definiciones:
//   • nueva     → conversación creada dentro del período
//   • activa    → conversación con al menos un mensaje en el período
//   • enviado   → mensaje saliente (sender_type = agent | bot)
//   • recibido  → mensaje entrante (sender_type = customer)
// ============================================================

import { localDayKey, mondayIndex } from "@/lib/dashboard/date-utils";

export interface MetricsConversationRow {
  id: string;
  contact_id: string | null;
  assigned_agent_id: string | null;
  channel: string | null;
  status: string;
  created_at: string;
  last_message_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
}

export interface MetricsMessageRow {
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  channel: string | null;
  created_at: string;
}

export interface MetricsTagLinkRow {
  conversation_id: string;
  created_at: string;
  tag: { id: string; name: string; color: string | null } | null;
}

export interface ConversationsSeriesPoint {
  day: string;
  active: number;
  created: number;
  sent: number;
  received: number;
}

export interface LabelMetric {
  id: string;
  name: string;
  color: string | null;
  count: number;
  lastAt: string | null;
}

export interface CloseReasonMetric {
  reason: string;
  count: number;
}

export interface ChannelConversationMetric {
  channel: string;
  active: number;
  created: number;
  sent: number;
  received: number;
}

export interface ConversationsResult {
  totals: {
    active: number;
    created: number;
    sent: number;
    received: number;
  };
  series: ConversationsSeriesPoint[];
  /** [7][24] — filas lunes→domingo, columnas 0..23 h. */
  heatmapIncoming: number[][];
  heatmapOutgoing: number[][];
  labels: LabelMetric[];
  closeReasons: CloseReasonMetric[];
  channels: ChannelConversationMetric[];
}

interface DayBucket {
  active: Set<string>;
  created: number;
  sent: number;
  received: number;
}

interface ChannelBucket {
  active: Set<string>;
  created: number;
  sent: number;
  received: number;
}

/** Crea una matriz 7×24 en ceros (lunes→domingo × 0..23 h). */
function emptyHeatmap(): number[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

/** Canal normalizado: si viene vacío, usamos 'whatsapp'. */
function normalizeChannel(channel: string | null | undefined): string {
  const value = (channel ?? "").trim();
  return value || "whatsapp";
}

export function aggregateConversations(
  conversations: MetricsConversationRow[],
  messages: MetricsMessageRow[],
  tagLinks: MetricsTagLinkRow[],
  dayKeys: string[]
): ConversationsResult {
  const dayKeySet = new Set(dayKeys);

  const channelById = new Map<string, string>();
  for (const c of conversations) {
    channelById.set(c.id, normalizeChannel(c.channel));
  }

  const days = new Map<string, DayBucket>();
  const ensureDay = (day: string): DayBucket => {
    let bucket = days.get(day);
    if (!bucket) {
      bucket = { active: new Set<string>(), created: 0, sent: 0, received: 0 };
      days.set(day, bucket);
    }
    return bucket;
  };
  // Garantiza que todos los días del rango existan aunque no tengan datos.
  for (const day of dayKeys) ensureDay(day);

  const channels = new Map<string, ChannelBucket>();
  const ensureChannel = (channel: string): ChannelBucket => {
    let bucket = channels.get(channel);
    if (!bucket) {
      bucket = { active: new Set<string>(), created: 0, sent: 0, received: 0 };
      channels.set(channel, bucket);
    }
    return bucket;
  };

  const heatmapIncoming = emptyHeatmap();
  const heatmapOutgoing = emptyHeatmap();

  const activeConversations = new Set<string>();
  const activePerDay = new Map<string, Set<string>>();

  // ---- 1) Conversaciones nuevas ---------------------------------
  for (const c of conversations) {
    const day = localDayKey(c.created_at);
    if (!dayKeySet.has(day)) continue;
    const channel = normalizeChannel(c.channel);
    ensureDay(day).created += 1;
    ensureChannel(channel).created += 1;
  }

  // ---- 2) Mensajes: serie, canales y mapas de calor -------------
  for (const m of messages) {
    const day = localDayKey(m.created_at);
    if (!dayKeySet.has(day)) continue;

    const isIncoming = m.sender_type === "customer";
    const channel = m.channel
      ? normalizeChannel(m.channel)
      : channelById.get(m.conversation_id) ?? "whatsapp";

    const bucket = ensureDay(day);
    const channelBucket = ensureChannel(channel);
    if (isIncoming) {
      bucket.received += 1;
      channelBucket.received += 1;
    } else {
      bucket.sent += 1;
      channelBucket.sent += 1;
    }

    bucket.active.add(m.conversation_id);
    activeConversations.add(m.conversation_id);
    channelBucket.active.add(m.conversation_id);

    let perDay = activePerDay.get(day);
    if (!perDay) {
      perDay = new Set<string>();
      activePerDay.set(day, perDay);
    }
    perDay.add(m.conversation_id);

    // Mapa de calor por (día de semana × hora) local.
    const when = new Date(m.created_at);
    const dow = mondayIndex(when);
    const hour = when.getHours();
    if (isIncoming) heatmapIncoming[dow][hour] += 1;
    else heatmapOutgoing[dow][hour] += 1;
  }

  // ---- 3) Etiquetas de conversación -----------------------------
  const labelAgg = new Map<
    string,
    { id: string; name: string; color: string | null; count: number; lastAt: string | null }
  >();
  for (const link of tagLinks) {
    if (!link.tag) continue;
    const current = labelAgg.get(link.tag.id) ?? {
      id: link.tag.id,
      name: link.tag.name,
      color: link.tag.color,
      count: 0,
      lastAt: null,
    };
    current.count += 1;
    if (!current.lastAt || link.created_at > current.lastAt) {
      current.lastAt = link.created_at;
    }
    labelAgg.set(link.tag.id, current);
  }

  // ---- 4) Motivos de cierre -------------------------------------
  const closeAgg = new Map<string, number>();
  for (const c of conversations) {
    if (!c.closed_at) continue;
    if (!dayKeySet.has(localDayKey(c.closed_at))) continue;
    const reason = (c.close_reason ?? "").trim() || "Sin motivo";
    closeAgg.set(reason, (closeAgg.get(reason) ?? 0) + 1);
  }

  // ---- 5) Salidas ------------------------------------------------
  const series: ConversationsSeriesPoint[] = dayKeys.map((day) => {
    const bucket = days.get(day);
    return {
      day,
      active: activePerDay.get(day)?.size ?? 0,
      created: bucket?.created ?? 0,
      sent: bucket?.sent ?? 0,
      received: bucket?.received ?? 0,
    };
  });

  const channelMetrics: ChannelConversationMetric[] = [...channels.entries()]
    .map(([channel, bucket]) => ({
      channel,
      active: bucket.active.size,
      created: bucket.created,
      sent: bucket.sent,
      received: bucket.received,
    }))
    .sort(
      (a, b) =>
        b.active + b.created + b.sent + b.received -
          (a.active + a.created + a.sent + a.received) ||
        a.channel.localeCompare(b.channel)
    );

  let sent = 0;
  let received = 0;
  for (const bucket of days.values()) {
    sent += bucket.sent;
    received += bucket.received;
  }
  let created = 0;
  for (const bucket of days.values()) created += bucket.created;

  return {
    totals: {
      active: activeConversations.size,
      created,
      sent,
      received,
    },
    series,
    heatmapIncoming,
    heatmapOutgoing,
    labels: [...labelAgg.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    ),
    closeReasons: [...closeAgg.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    channels: channelMetrics,
  };
}
