// ============================================================
// Productividad / Auditoría de agentes — módulo 2.4
//
// Métricas DERIVADAS de las tablas existentes: no requiere
// migración (mismo enfoque que el módulo 1.6 Timeline). Cada fila
// que lleva autoría (`user_id`, `assigned_to`, `created_by`,
// `sender_id`) se atribuye al perfil correspondiente dentro de la
// cuenta, y el período se filtra por `created_at`.
//
// `user_id` (y equivalentes) apuntan a `auth.users.id` =
// `profiles.user_id`; `assigned_to` apunta a `profiles.id`. Aquí se
// normaliza todo a `profiles.id`.
// ============================================================

import type { AccountRole } from "@/lib/auth/roles";
import type { Profile } from "@/types";

// ------------------------------------------------------------
// Períodos
// ------------------------------------------------------------
export type PeriodKey = "7" | "30" | "90" | "all";

export const PERIODS: Array<{ key: PeriodKey; label: string; days: number | null }> = [
  { key: "7", label: "7 días", days: 7 },
  { key: "30", label: "30 días", days: 30 },
  { key: "90", label: "90 días", days: 90 },
  { key: "all", label: "Todo", days: null },
];

/** ISO de corte para el período, o `null` para "Todo". */
export function periodStartIso(key: PeriodKey): string | null {
  const days = PERIODS.find((p) => p.key === key)?.days ?? null;
  if (days === null) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ------------------------------------------------------------
// Filas de origen (subconjunto de columnas que consulta la página)
// ------------------------------------------------------------
export interface LeadRow {
  id: string;
  created_at: string;
  user_id?: string | null;
  assigned_to?: string | null;
  status?: string | null;
  converted_at?: string | null;
  name?: string | null;
}

export interface DealRow {
  id: string;
  created_at: string;
  user_id?: string | null;
  assigned_to?: string | null;
  status?: string | null;
  value?: number | null;
  currency?: string | null;
  title?: string | null;
}

export interface ActivityRow {
  id: string;
  created_at: string;
  user_id?: string | null;
  assigned_to?: string | null;
  status?: string | null;
  subject?: string | null;
}

export interface NoteRow {
  id: string;
  created_at: string;
  user_id?: string | null;
}

export interface ContactNoteRow {
  id: string;
  created_at: string;
  user_id?: string | null;
}

export interface AttachmentRow {
  id: string;
  created_at: string;
  user_id?: string | null;
  file_name?: string | null;
}

export interface PaymentRow {
  id: string;
  created_at: string;
  created_by?: string | null;
  amount?: number | null;
}

export interface ReceivableRow {
  id: string;
  created_at: string;
  created_by?: string | null;
}

export interface ChatMessageRow {
  id: string;
  created_at: string;
  sender_id?: string | null;
  body?: string | null;
}

export interface ChannelRow {
  id: string;
  created_at: string;
  created_by?: string | null;
  name?: string | null;
}

export interface ConversationRow {
  id: string;
  created_at: string;
  assigned_agent_id?: string | null;
  status?: string | null;
}

// ------------------------------------------------------------
// Resultado
// ------------------------------------------------------------
export interface AgentMetrics {
  /** `profiles.id` — clave interna de agregación. */
  profileId: string;
  /** `auth.users.id` = `profiles.user_id`. */
  userId: string;
  fullName: string;
  email: string;
  role?: AccountRole;

  leadsCreated: number;
  leadsConverted: number;
  leadsAssigned: number;

  dealsCreated: number;
  dealsWon: number;
  /** Monto ganado desglosado por moneda (no se mezclan divisas). */
  wonByCurrency: Record<string, number>;

  activitiesCreated: number;
  activitiesAssigned: number;
  activitiesDone: number;

  notesCreated: number;
  contactNotesCreated: number;
  attachmentsUploaded: number;

  paymentsRegistered: number;
  paymentsAmount: number;
  receivablesCreated: number;

  chatMessagesSent: number;
  channelsCreated: number;
  conversationsAssigned: number;

  /** Índice ponderado de actividad (ver `SCORE_WEIGHTS`). */
  score: number;
  lastActivityAt: string | null;
}

export type FeedKind =
  | "lead"
  | "deal"
  | "deal_won"
  | "activity"
  | "activity_done"
  | "note"
  | "contact_note"
  | "attachment"
  | "payment"
  | "receivable"
  | "chat"
  | "channel"
  | "conversation";

export interface FeedItem {
  id: string;
  kind: FeedKind;
  /** `profiles.id` del autor. */
  actorId: string;
  createdAt: string;
  title: string;
  detail?: string;
}

export interface ProductivityResult {
  agents: AgentMetrics[];
  feed: FeedItem[];
  totals: {
    agentsActive: number;
    dealsWon: number;
    activitiesDone: number;
    leadsConverted: number;
    wonByCurrency: Record<string, number>;
  };
}

export interface ProductivitySource {
  profiles: Profile[];
  leads: LeadRow[];
  deals: DealRow[];
  activities: ActivityRow[];
  notes: NoteRow[];
  contactNotes: ContactNoteRow[];
  attachments: AttachmentRow[];
  payments: PaymentRow[];
  receivables: ReceivableRow[];
  chatMessages: ChatMessageRow[];
  channels: ChannelRow[];
  conversations: ConversationRow[];
}

// Pesos del índice. Documentados y exportados para mostrarlos como
// leyenda en la UI — el ranking nunca es una caja negra.
export const SCORE_WEIGHTS: Array<{ key: keyof AgentMetrics; weight: number; label: string }> = [
  { key: "dealsWon", weight: 10, label: "Oferta ganada" },
  { key: "leadsConverted", weight: 4, label: "Lead convertido" },
  { key: "activitiesDone", weight: 3, label: "Actividad completada" },
  { key: "dealsCreated", weight: 2, label: "Oferta creada" },
  { key: "paymentsRegistered", weight: 2, label: "Abono registrado" },
  { key: "leadsCreated", weight: 1, label: "Lead creado" },
  { key: "activitiesAssigned", weight: 1, label: "Actividad asignada" },
  { key: "notesCreated", weight: 1, label: "Nota interna" },
  { key: "contactNotesCreated", weight: 1, label: "Nota de contacto" },
  { key: "attachmentsUploaded", weight: 1, label: "Adjunto subido" },
  { key: "chatMessagesSent", weight: 1, label: "Mensaje de chat" },
  { key: "receivablesCreated", weight: 1, label: "CxC creada" },
  { key: "channelsCreated", weight: 1, label: "Canal creado" },
];

function emptyMetrics(p: Profile): AgentMetrics {
  return {
    profileId: p.id,
    userId: p.user_id,
    fullName: p.full_name || "Sin nombre",
    email: p.email,
    role: p.account_role,
    leadsCreated: 0,
    leadsConverted: 0,
    leadsAssigned: 0,
    dealsCreated: 0,
    dealsWon: 0,
    wonByCurrency: {},
    activitiesCreated: 0,
    activitiesAssigned: 0,
    activitiesDone: 0,
    notesCreated: 0,
    contactNotesCreated: 0,
    attachmentsUploaded: 0,
    paymentsRegistered: 0,
    paymentsAmount: 0,
    receivablesCreated: 0,
    chatMessagesSent: 0,
    channelsCreated: 0,
    conversationsAssigned: 0,
    score: 0,
    lastActivityAt: null,
  };
}

/**
 * Agrega las filas de origen en métricas por agente + un feed de
 * auditoría (últimas acciones, más recientes primero).
 */
export function aggregateProductivity(src: ProductivitySource): ProductivityResult {
  const byProfileId = new Map<string, AgentMetrics>();
  const byUserId = new Map<string, AgentMetrics>();

  for (const p of src.profiles) {
    const m = emptyMetrics(p);
    byProfileId.set(p.id, m);
    if (p.user_id) byUserId.set(p.user_id, m);
  }

  const feed: FeedItem[] = [];

  const actorByUser = (uid?: string | null): AgentMetrics | null =>
    uid ? (byUserId.get(uid) ?? null) : null;
  const actorByProfile = (pid?: string | null): AgentMetrics | null =>
    pid ? (byProfileId.get(pid) ?? null) : null;

  const touch = (m: AgentMetrics, at: string) => {
    if (!m.lastActivityAt || at > m.lastActivityAt) m.lastActivityAt = at;
  };

  const tag = (row: { user_id?: string | null; assigned_to?: string | null }) =>
    actorByUser(row.user_id) ?? actorByProfile(row.assigned_to);

  // Leads
  for (const r of src.leads) {
    const m = tag(r);
    if (!m) continue;
    m.leadsCreated += 1;
    if (r.status === "converted" || r.converted_at) m.leadsConverted += 1;
    if (r.assigned_to) {
      const a = actorByProfile(r.assigned_to);
      if (a) a.leadsAssigned += 1;
    }
    touch(m, r.created_at);
    feed.push({
      id: `lead:${r.id}`,
      kind: "lead",
      actorId: m.profileId,
      createdAt: r.created_at,
      title: r.status === "converted" ? "Lead convertido" : "Lead creado",
      detail: r.name ?? undefined,
    });
  }

  // Deals
  for (const r of src.deals) {
    const m = tag(r);
    if (!m) continue;
    const won = r.status === "won";
    m.dealsCreated += 1;
    if (won) {
      m.dealsWon += 1;
      const cur = (r.currency || "USD").toUpperCase();
      m.wonByCurrency[cur] = (m.wonByCurrency[cur] ?? 0) + (Number(r.value) || 0);
    }
    touch(m, r.created_at);
    feed.push({
      id: `deal:${r.id}`,
      kind: won ? "deal_won" : "deal",
      actorId: m.profileId,
      createdAt: r.created_at,
      title: won ? "Oferta ganada" : "Oferta creada",
      detail: r.title ?? undefined,
    });
  }

  // Activities
  for (const r of src.activities) {
    const m = tag(r);
    if (!m) continue;
    m.activitiesCreated += 1;
    if (r.status === "done") m.activitiesDone += 1;
    if (r.assigned_to) {
      const a = actorByProfile(r.assigned_to);
      if (a) a.activitiesAssigned += 1;
    }
    touch(m, r.created_at);
    feed.push({
      id: `activity:${r.id}`,
      kind: r.status === "done" ? "activity_done" : "activity",
      actorId: m.profileId,
      createdAt: r.created_at,
      title: r.status === "done" ? "Actividad completada" : "Actividad creada",
      detail: r.subject ?? undefined,
    });
  }

  // Notes (internas, módulo 1.4)
  for (const r of src.notes) {
    const m = actorByUser(r.user_id);
    if (!m) continue;
    m.notesCreated += 1;
    touch(m, r.created_at);
    feed.push({
      id: `note:${r.id}`,
      kind: "note",
      actorId: m.profileId,
      createdAt: r.created_at,
      title: "Nota interna",
    });
  }

  // Contact notes (notas rápidas del inbox)
  for (const r of src.contactNotes) {
    const m = actorByUser(r.user_id);
    if (!m) continue;
    m.contactNotesCreated += 1;
    touch(m, r.created_at);
    feed.push({
      id: `contact_note:${r.id}`,
      kind: "contact_note",
      actorId: m.profileId,
      createdAt: r.created_at,
      title: "Nota de contacto",
    });
  }

  // Attachments
  for (const r of src.attachments) {
    const m = actorByUser(r.user_id);
    if (!m) continue;
    m.attachmentsUploaded += 1;
    touch(m, r.created_at);
    feed.push({
      id: `attachment:${r.id}`,
      kind: "attachment",
      actorId: m.profileId,
      createdAt: r.created_at,
      title: "Adjunto subido",
      detail: r.file_name ?? undefined,
    });
  }

  // Abonos (Cobranza)
  for (const r of src.payments) {
    const m = actorByUser(r.created_by);
    if (!m) continue;
    m.paymentsRegistered += 1;
    m.paymentsAmount += Number(r.amount) || 0;
    touch(m, r.created_at);
    feed.push({
      id: `payment:${r.id}`,
      kind: "payment",
      actorId: m.profileId,
      createdAt: r.created_at,
      title: "Abono registrado",
    });
  }

  // Cuentas por cobrar creadas
  for (const r of src.receivables) {
    const m = actorByUser(r.created_by);
    if (!m) continue;
    m.receivablesCreated += 1;
    touch(m, r.created_at);
    feed.push({
      id: `receivable:${r.id}`,
      kind: "receivable",
      actorId: m.profileId,
      createdAt: r.created_at,
      title: "Cuenta por cobrar creada",
    });
  }

  // Chat interno
  for (const r of src.chatMessages) {
    const m = actorByUser(r.sender_id);
    if (!m) continue;
    m.chatMessagesSent += 1;
    touch(m, r.created_at);
    feed.push({
      id: `chat:${r.id}`,
      kind: "chat",
      actorId: m.profileId,
      createdAt: r.created_at,
      title: "Mensaje de chat",
      detail: r.body ? r.body.slice(0, 80) : undefined,
    });
  }

  // Canales de chat creados
  for (const r of src.channels) {
    const m = actorByUser(r.created_by);
    if (!m) continue;
    m.channelsCreated += 1;
    touch(m, r.created_at);
    feed.push({
      id: `channel:${r.id}`,
      kind: "channel",
      actorId: m.profileId,
      createdAt: r.created_at,
      title: "Canal creado",
      detail: r.name ?? undefined,
    });
  }

  // Conversaciones asignadas
  for (const r of src.conversations) {
    const m = actorByUser(r.assigned_agent_id);
    if (!m) continue;
    m.conversationsAssigned += 1;
    touch(m, r.created_at);
    feed.push({
      id: `conversation:${r.id}`,
      kind: "conversation",
      actorId: m.profileId,
      createdAt: r.created_at,
      title: "Conversación asignada",
    });
  }

  // Índice ponderado
  const agents = [...byProfileId.values()];
  for (const m of agents) {
    let score = 0;
    for (const w of SCORE_WEIGHTS) {
      const v = m[w.key];
      if (typeof v === "number") score += v * w.weight;
    }
    m.score = score;
  }

  const wonByCurrency: Record<string, number> = {};
  for (const m of agents) {
    for (const [cur, amount] of Object.entries(m.wonByCurrency)) {
      wonByCurrency[cur] = (wonByCurrency[cur] ?? 0) + amount;
    }
  }

  feed.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return {
    agents,
    feed: feed.slice(0, 40),
    totals: {
      agentsActive: agents.filter((m) => m.lastActivityAt !== null).length,
      dealsWon: agents.reduce((s, m) => s + m.dealsWon, 0),
      activitiesDone: agents.reduce((s, m) => s + m.activitiesDone, 0),
      leadsConverted: agents.reduce((s, m) => s + m.leadsConverted, 0),
      wonByCurrency,
    },
  };
}

/** Suma de todas las monedas ganadas (para orden por "monto total"). */
export function totalWonValue(m: AgentMetrics): number {
  return Object.values(m.wonByCurrency).reduce((s, v) => s + v, 0);
}
