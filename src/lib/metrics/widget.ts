// ============================================================
// Métricas · Widget (webchat) — agregación pura.
//
// El widget del sitio web escribe en el canal `webchat`. Aquí se mide
// su rendimiento: conversaciones iniciadas, mensajes, tiempo de
// primera respuesta y tasa de atención.
//
// Definiciones:
//   • conversación      → hilo de `webchat` con ≥1 mensaje del período.
//   • nueva             → hilo de `webchat` creado dentro del período.
//   • entrante/saliente → `sender_type` customer / (agent | bot).
//   • 1ª respuesta      → minutos desde el primer mensaje del cliente
//     hasta la primera respuesta (agente o bot) posterior.
//   • tasa de respuesta → conversaciones con ≥1 respuesta / total.
// ============================================================

import { localDayKey } from "@/lib/dashboard/date-utils";

export interface WidgetMessageRow {
  conversation_id: string;
  sender_type: string;
  created_at: string;
}

export interface WidgetConversationRow {
  id: string;
  created_at: string;
  contact_id: string | null;
  status: string | null;
}

export interface WidgetContactRow {
  id: string;
  name: string | null;
}

export interface WidgetTotals {
  conversations: number;
  newConversations: number;
  messages: number;
  incoming: number;
  outgoing: number;
  avgFirstResponseMinutes: number | null;
  responseRate: number | null;
  messagesPerConversation: number | null;
}

export interface WidgetSeriesPoint {
  day: string;
  incoming: number;
  outgoing: number;
}

export interface WidgetConversationTableRow {
  id: string;
  contactName: string;
  messages: number;
  incoming: number;
  firstResponseMinutes: number | null;
  status: string | null;
  lastMessageAt: string;
}

export interface WidgetConfig {
  enabled: boolean;
  title: string;
  welcomeMessage: string | null;
  color: string;
  position: string;
}

export interface WidgetResult {
  totals: WidgetTotals;
  series: WidgetSeriesPoint[];
  conversations: WidgetConversationTableRow[];
  config: WidgetConfig | null;
}

interface ConversationAccumulator {
  id: string;
  incoming: number;
  outgoing: number;
  messages: number;
  firstCustomerAt: number | null;
  firstResponseAt: number | null;
  lastMessageAt: number;
}

export function aggregateWidget(params: {
  messages: WidgetMessageRow[];
  conversations: WidgetConversationRow[];
  contacts: WidgetContactRow[];
  dayKeys: string[];
  config: WidgetConfig | null;
  /** false cuando el filtro de canal excluye el webchat. */
  allowed: boolean;
}): WidgetResult {
  const { messages, conversations, contacts, dayKeys, config, allowed } = params;
  const dayKeySet = new Set(dayKeys);

  const seriesMap = new Map<string, WidgetSeriesPoint>();
  for (const day of dayKeys) seriesMap.set(day, { day, incoming: 0, outgoing: 0 });

  if (!allowed) {
    return {
      totals: emptyTotals(),
      series: dayKeys.map((day) => ({ day, incoming: 0, outgoing: 0 })),
      conversations: [],
      config,
    };
  }

  const contactName = new Map<string, string>();
  for (const c of contacts) contactName.set(c.id, c.name ?? "Sin nombre");

  const conversationById = new Map<string, WidgetConversationRow>();
  for (const c of conversations) conversationById.set(c.id, c);

  const acc = new Map<string, ConversationAccumulator>();
  const ensure = (id: string): ConversationAccumulator => {
    let a = acc.get(id);
    if (!a) {
      a = {
        id,
        incoming: 0,
        outgoing: 0,
        messages: 0,
        firstCustomerAt: null,
        firstResponseAt: null,
        lastMessageAt: 0,
      };
      acc.set(id, a);
    }
    return a;
  };

  let incoming = 0;
  let outgoing = 0;

  for (const m of messages) {
    const a = ensure(m.conversation_id);
    const ts = new Date(m.created_at).getTime();
    if (!Number.isFinite(ts)) continue;

    a.messages += 1;
    if (ts > a.lastMessageAt) a.lastMessageAt = ts;

    if (m.sender_type === "customer") {
      incoming += 1;
      a.incoming += 1;
      if (a.firstCustomerAt === null || ts < a.firstCustomerAt) {
        a.firstCustomerAt = ts;
      }
    } else {
      outgoing += 1;
      a.outgoing += 1;
    }

    const day = localDayKey(m.created_at);
    const point = seriesMap.get(day);
    if (point) {
      if (m.sender_type === "customer") point.incoming += 1;
      else point.outgoing += 1;
    }
  }

  // 1ª respuesta: primera salida posterior al primer mensaje del cliente.
  for (const m of messages) {
    if (m.sender_type === "customer") continue;
    const a = acc.get(m.conversation_id);
    if (!a || a.firstCustomerAt === null) continue;
    const ts = new Date(m.created_at).getTime();
    if (!Number.isFinite(ts) || ts < a.firstCustomerAt) continue;
    if (a.firstResponseAt === null || ts < a.firstResponseAt) {
      a.firstResponseAt = ts;
    }
  }

  let firstResponseSum = 0;
  let firstResponseCount = 0;
  let responded = 0;
  const tableRows: WidgetConversationTableRow[] = [];

  for (const a of acc.values()) {
    let firstResponseMinutes: number | null = null;
    if (a.firstCustomerAt !== null && a.firstResponseAt !== null) {
      firstResponseMinutes =
        (a.firstResponseAt - a.firstCustomerAt) / 60000;
      firstResponseSum += firstResponseMinutes;
      firstResponseCount += 1;
    }
    if (a.outgoing > 0) responded += 1;

    const conv = conversationById.get(a.id);
    const contactId = conv?.contact_id ?? null;
    tableRows.push({
      id: a.id,
      contactName: contactId
        ? contactName.get(contactId) ?? "Sin nombre"
        : "Visitante",
      messages: a.messages,
      incoming: a.incoming,
      firstResponseMinutes,
      status: conv?.status ?? null,
      lastMessageAt: a.lastMessageAt ? new Date(a.lastMessageAt).toISOString() : "",
    });
  }

  tableRows.sort(
    (x, y) =>
      new Date(y.lastMessageAt).getTime() - new Date(x.lastMessageAt).getTime()
  );

  let newConversations = 0;
  for (const c of conversations) {
    if (dayKeySet.has(localDayKey(c.created_at))) newConversations += 1;
  }

  const totalConversations = acc.size;

  return {
    totals: {
      conversations: totalConversations,
      newConversations,
      messages: incoming + outgoing,
      incoming,
      outgoing,
      avgFirstResponseMinutes:
        firstResponseCount > 0 ? firstResponseSum / firstResponseCount : null,
      responseRate: rate(responded, totalConversations),
      messagesPerConversation: rate(incoming + outgoing, totalConversations),
    },
    series: dayKeys.map((day) => seriesMap.get(day) ?? { day, incoming: 0, outgoing: 0 }),
    conversations: tableRows,
    config,
  };
}

function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

function emptyTotals(): WidgetTotals {
  return {
    conversations: 0,
    newConversations: 0,
    messages: 0,
    incoming: 0,
    outgoing: 0,
    avgFirstResponseMinutes: null,
    responseRate: null,
    messagesPerConversation: null,
  };
}
