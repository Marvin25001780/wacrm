// ============================================================
// Métricas · Agentes IA — agregación pura.
//
// En este CRM "agente IA" cubre dos motores que escriben solos:
//   • el asistente de IA por cuenta (`ai_configs`), que responde en
//     la Bandeja y cuyos mensajes viajan con `sender_type = 'bot'`;
//   • los flujos (`flow_runs`) y automatizaciones (`automation_logs`),
//     que también envían mensajes como `bot`.
//
// Definiciones:
//   • respuesta automática → mensaje con `sender_type = 'bot'` del
//     período (IA, flujo o automatización).
//   • conversación con IA  → conversación con ≥1 respuesta automática.
//   • % de atención        → bot / (bot + agentes humanos).
//   • derivación a humano  → conversación con `ai_autoreply_disabled`
//     (estado actual; el modelo o un agente la sacó de la IA).
//   • ejecución de flujo   → `flow_runs` iniciada en el período.
//   • ejecución de automatización → `automation_logs` del período.
//
// La función recibe filas ya filtradas por rango y canal; el filtro de
// agente/equipo no aplica aquí (la IA atiende antes de asignar).
// ============================================================

import { localDayKey } from "@/lib/dashboard/date-utils";

export interface AiMessageRow {
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  channel: string | null;
  created_at: string;
}

export interface AiConversationRow {
  id: string;
  channel: string | null;
  ai_reply_count: number;
  ai_autoreply_disabled: boolean;
}

export interface AiFlowRunRow {
  flow_id: string;
  status: string;
  started_at: string;
}

export interface AiAutomationLogRow {
  automation_id: string;
  status: string;
  created_at: string;
}

export interface AiNamedOption {
  id: string;
  name: string | null;
}

export interface AgentsIaConfig {
  provider: string;
  model: string;
  fallbackModel: string | null;
  isActive: boolean;
  autoReplyEnabled: boolean;
  maxPerConversation: number;
}

export interface AgentsIaTotals {
  botMessages: number;
  agentMessages: number;
  customerMessages: number;
  botConversations: number;
  automationShare: number | null;
  flowRuns: number;
  flowsCompleted: number;
  flowsHandedOff: number;
  flowsActive: number;
  flowCompletionRate: number | null;
  automationRuns: number;
  automationFailed: number;
  handoffs: number;
}

export interface AgentsIaSeriesPoint {
  day: string;
  bot: number;
  agent: number;
}

export interface AgentsIaFlowRow {
  key: string;
  name: string;
  runs: number;
  completed: number;
  handedOff: number;
  active: number;
  timedOut: number;
  failed: number;
  completionRate: number | null;
}

export interface AgentsIaAutomationRow {
  key: string;
  name: string;
  runs: number;
  success: number;
  partial: number;
  failed: number;
  successRate: number | null;
}

export interface AgentsIaChannelRow {
  channel: string;
  botMessages: number;
  conversations: number;
}

export interface AgentsIaResult {
  totals: AgentsIaTotals;
  series: AgentsIaSeriesPoint[];
  flows: AgentsIaFlowRow[];
  automations: AgentsIaAutomationRow[];
  channels: AgentsIaChannelRow[];
  config: AgentsIaConfig | null;
}

/** Canal normalizado: si viene vacío, usamos 'whatsapp'. */
function normalizeChannel(channel: string | null | undefined): string {
  const value = (channel ?? "").trim();
  return value || "whatsapp";
}

function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function aggregateAgentsIa(params: {
  messages: AiMessageRow[];
  conversations: AiConversationRow[];
  flowRuns: AiFlowRunRow[];
  automationLogs: AiAutomationLogRow[];
  flows: AiNamedOption[];
  automations: AiNamedOption[];
  config: AgentsIaConfig | null;
  dayKeys: string[];
}): AgentsIaResult {
  const {
    messages,
    conversations,
    flowRuns,
    automationLogs,
    flows,
    automations,
    config,
    dayKeys,
  } = params;

  const dayKeySet = new Set(dayKeys);

  // ---- Serie diaria (bot vs agentes) -----------------------------
  const seriesMap = new Map<string, AgentsIaSeriesPoint>();
  for (const day of dayKeys) {
    seriesMap.set(day, { day, bot: 0, agent: 0 });
  }

  // ---- Mensajes --------------------------------------------------
  const channelById = new Map<string, string>();
  for (const c of conversations) {
    channelById.set(c.id, normalizeChannel(c.channel));
  }

  const botConversations = new Set<string>();
  const channelBot = new Map<string, number>();
  const channelConversations = new Map<string, Set<string>>();

  let botMessages = 0;
  let agentMessages = 0;
  let customerMessages = 0;

  for (const m of messages) {
    if (m.sender_type === "customer") {
      customerMessages += 1;
      continue;
    }
    const day = localDayKey(m.created_at);
    const point = seriesMap.get(day);
    if (m.sender_type === "agent") {
      agentMessages += 1;
      if (point) point.agent += 1;
      continue;
    }
    if (m.sender_type !== "bot") continue;

    botMessages += 1;
    if (point && dayKeySet.has(day)) point.bot += 1;

    const channel = m.channel
      ? normalizeChannel(m.channel)
      : channelById.get(m.conversation_id) ?? "whatsapp";
    channelBot.set(channel, (channelBot.get(channel) ?? 0) + 1);
    botConversations.add(m.conversation_id);
    const set = channelConversations.get(channel) ?? new Set<string>();
    set.add(m.conversation_id);
    channelConversations.set(channel, set);
  }

  const series = dayKeys.map(
    (day) => seriesMap.get(day) ?? { day, bot: 0, agent: 0 }
  );

  // ---- Flujos ----------------------------------------------------
  const flowName = new Map<string, string>();
  for (const f of flows) flowName.set(f.id, f.name ?? "Flujo sin nombre");

  const flowMap = new Map<string, AgentsIaFlowRow>();
  const ensureFlow = (id: string): AgentsIaFlowRow => {
    let row = flowMap.get(id);
    if (!row) {
      row = {
        key: id,
        name: flowName.get(id) ?? "Flujo eliminado",
        runs: 0,
        completed: 0,
        handedOff: 0,
        active: 0,
        timedOut: 0,
        failed: 0,
        completionRate: null,
      };
      flowMap.set(id, row);
    }
    return row;
  };

  let flowsCompleted = 0;
  let flowsHandedOff = 0;
  let flowsActive = 0;
  for (const run of flowRuns) {
    const row = ensureFlow(run.flow_id);
    row.runs += 1;
    switch (run.status) {
      case "completed":
        row.completed += 1;
        flowsCompleted += 1;
        break;
      case "handed_off":
        row.handedOff += 1;
        flowsHandedOff += 1;
        break;
      case "active":
        row.active += 1;
        flowsActive += 1;
        break;
      case "timed_out":
        row.timedOut += 1;
        break;
      case "failed":
        row.failed += 1;
        break;
    }
  }
  const flowRows = [...flowMap.values()].sort((a, b) => b.runs - a.runs);
  for (const row of flowRows) {
    row.completionRate = rate(row.completed, row.runs);
  }

  // ---- Automatizaciones ------------------------------------------
  const automationName = new Map<string, string>();
  for (const a of automations) {
    automationName.set(a.id, a.name ?? "Automatización sin nombre");
  }

  const automationMap = new Map<string, AgentsIaAutomationRow>();
  const ensureAutomation = (id: string): AgentsIaAutomationRow => {
    let row = automationMap.get(id);
    if (!row) {
      row = {
        key: id,
        name: automationName.get(id) ?? "Automatización eliminada",
        runs: 0,
        success: 0,
        partial: 0,
        failed: 0,
        successRate: null,
      };
      automationMap.set(id, row);
    }
    return row;
  };

  let automationFailed = 0;
  for (const log of automationLogs) {
    const row = ensureAutomation(log.automation_id);
    row.runs += 1;
    if (log.status === "success") row.success += 1;
    else if (log.status === "partial") row.partial += 1;
    else if (log.status === "failed") {
      row.failed += 1;
      automationFailed += 1;
    }
  }
  const automationRows = [...automationMap.values()].sort(
    (a, b) => b.runs - a.runs
  );
  for (const row of automationRows) {
    row.successRate = rate(row.success, row.runs);
  }

  // ---- Canales ---------------------------------------------------
  const channels: AgentsIaChannelRow[] = [];
  for (const [channel, count] of channelBot) {
    channels.push({
      channel,
      botMessages: count,
      conversations: channelConversations.get(channel)?.size ?? 0,
    });
  }
  channels.sort((a, b) => b.botMessages - a.botMessages);

  // ---- Derivaciones (estado actual) ------------------------------
  let handoffs = 0;
  for (const c of conversations) {
    if (c.ai_autoreply_disabled) handoffs += 1;
  }

  const outboundHumanPlusBot = botMessages + agentMessages;

  return {
    totals: {
      botMessages,
      agentMessages,
      customerMessages,
      botConversations: botConversations.size,
      automationShare: rate(botMessages, outboundHumanPlusBot),
      flowRuns: flowRuns.length,
      flowsCompleted,
      flowsHandedOff,
      flowsActive,
      flowCompletionRate: rate(flowsCompleted, flowRuns.length),
      automationRuns: automationLogs.length,
      automationFailed,
      handoffs,
    },
    series,
    flows: flowRows,
    automations: automationRows,
    channels,
    config,
  };
}
