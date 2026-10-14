// ============================================================
// Métricas · Uso de Meta — agregación pura.
//
// Mide la actividad de los canales de Meta (WhatsApp, Instagram
// Direct y Facebook Messenger): volumen de mensajes, reparto
// entrante/saliente, plantillas enviadas y fallos de entrega.
//
// Definiciones:
//   • canal efectivo → `messages.channel` (con respaldo 'whatsapp',
//     que es el DEFAULT histórico).
//   • entrante  → `sender_type = 'customer'`.
//   • saliente  → `sender_type = 'agent' | 'bot'`.
//   • plantilla → `content_type = 'template'` o `template_name`
//     presente (mensajes de plantilla de Meta).
//   • entregado → `status` 'delivered' o 'read'.
// ============================================================

import { localDayKey } from "@/lib/dashboard/date-utils";

export const META_CHANNELS = ["whatsapp", "instagram", "facebook"] as const;
export type MetaChannel = (typeof META_CHANNELS)[number];

export function isMetaChannel(value: string): value is MetaChannel {
  return (META_CHANNELS as readonly string[]).includes(value);
}

export interface MetaMessageRow {
  conversation_id: string;
  sender_type: string;
  channel: string | null;
  content_type: string | null;
  template_name: string | null;
  status: string | null;
  created_at: string;
}

export interface MetaConversationRow {
  id: string;
  channel: string | null;
  created_at: string;
}

export interface MetaTotals {
  messages: number;
  incoming: number;
  outgoing: number;
  conversations: number;
  newConversations: number;
  templates: number;
  failed: number;
  delivered: number;
}

export interface MetaSeriesPoint {
  day: string;
  whatsapp: number;
  instagram: number;
  facebook: number;
}

export interface MetaChannelRow {
  channel: MetaChannel;
  conversations: number;
  messages: number;
  incoming: number;
  outgoing: number;
  templates: number;
  failed: number;
}

export interface MetaTemplateRow {
  name: string;
  count: number;
  channels: string[];
}

export interface MetaUsageResult {
  totals: MetaTotals;
  series: MetaSeriesPoint[];
  channels: MetaChannelRow[];
  templates: MetaTemplateRow[];
}

function emptySeriesPoint(day: string): MetaSeriesPoint {
  return { day, whatsapp: 0, instagram: 0, facebook: 0 };
}

function effectiveChannel(channel: string | null | undefined): string {
  return (channel ?? "").trim() || "whatsapp";
}

export function aggregateMetaUsage(params: {
  messages: MetaMessageRow[];
  /** Conversaciones creadas dentro del rango (para "nuevas"). */
  conversations: MetaConversationRow[];
  dayKeys: string[];
  /** Canales Meta permitidos por el filtro (subconjunto de META_CHANNELS). */
  allowedChannels: MetaChannel[];
}): MetaUsageResult {
  const { messages, conversations, dayKeys, allowedChannels } = params;
  const allowed = new Set<string>(allowedChannels);

  const seriesMap = new Map<string, MetaSeriesPoint>();
  for (const day of dayKeys) seriesMap.set(day, emptySeriesPoint(day));

  const channelMap = new Map<MetaChannel, MetaChannelRow>();
  const ensureChannel = (channel: MetaChannel): MetaChannelRow => {
    let row = channelMap.get(channel);
    if (!row) {
      row = {
        channel,
        conversations: 0,
        messages: 0,
        incoming: 0,
        outgoing: 0,
        templates: 0,
        failed: 0,
      };
      channelMap.set(channel, row);
    }
    return row;
  };

  const convSets = new Map<MetaChannel, Set<string>>();
  const channelConversations = (channel: MetaChannel): Set<string> => {
    let set = convSets.get(channel);
    if (!set) {
      set = new Set<string>();
      convSets.set(channel, set);
    }
    return set;
  };

  const templateMap = new Map<string, MetaTemplateRow>();
  let failed = 0;
  let delivered = 0;

  for (const m of messages) {
    const channel = effectiveChannel(m.channel);
    if (!isMetaChannel(channel) || !allowed.has(channel)) continue;

    const row = ensureChannel(channel);
    const isIncoming = m.sender_type === "customer";
    row.messages += 1;
    if (isIncoming) row.incoming += 1;
    else row.outgoing += 1;

    if (m.content_type === "template" || m.template_name) {
      row.templates += 1;
      const name = m.template_name || "(sin nombre)";
      const t = templateMap.get(name) ?? { name, count: 0, channels: [] };
      t.count += 1;
      if (!t.channels.includes(channel)) t.channels.push(channel);
      templateMap.set(name, t);
    }

    if (m.status === "failed") {
      row.failed += 1;
      failed += 1;
    } else if (m.status === "delivered" || m.status === "read") {
      delivered += 1;
    }

    channelConversations(channel).add(m.conversation_id);

    const day = localDayKey(m.created_at);
    const point = seriesMap.get(day);
    if (point) point[channel] += 1;
  }

  let incoming = 0;
  let outgoing = 0;
  for (const row of channelMap.values()) {
    row.conversations = convSets.get(row.channel)?.size ?? 0;
    incoming += row.incoming;
    outgoing += row.outgoing;
  }

  const allConversations = new Set<string>();
  for (const set of convSets.values()) {
    for (const id of set) allConversations.add(id);
  }

  let newConversations = 0;
  for (const c of conversations) {
    const channel = effectiveChannel(c.channel);
    if (isMetaChannel(channel) && allowed.has(channel)) newConversations += 1;
  }

  const channels = [...channelMap.values()].sort(
    (a, b) => b.messages - a.messages
  );

  return {
    totals: {
      messages: incoming + outgoing,
      incoming,
      outgoing,
      conversations: allConversations.size,
      newConversations,
      templates: [...templateMap.values()].reduce((sum, t) => sum + t.count, 0),
      failed,
      delivered,
    },
    series: dayKeys.map((day) => seriesMap.get(day) ?? emptySeriesPoint(day)),
    channels,
    templates: [...templateMap.values()].sort((a, b) => b.count - a.count),
  };
}
