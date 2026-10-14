"use client";

// ============================================================
// Métricas · Agentes IA
//
// Cómo trabajan los motores automáticos de la cuenta: el asistente de
// IA (respuestas con `sender_type = 'bot'`), los flujos y las
// automatizaciones. Muestra volumen de respuestas automáticas, la
// proporción frente a los agentes humanos, ejecuciones de flujos y
// automatizaciones, derivaciones a humano y el estado de la
// configuración de IA.
//
// Filtros: se respeta el rango de tiempo y el canal. El filtro de
// agente/equipo no aplica (la IA responde antes de asignar un humano).
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Download,
  MessagesSquare,
  Percent,
  Sparkles,
  UserRoundCheck,
  Workflow,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { Panel } from "@/components/metrics/panel";
import { Donut } from "@/components/metrics/donut";
import { BarChart } from "@/components/tremor/bar-chart";
import { Button } from "@/components/ui/button";
import { useMetricsFilters } from "@/components/metrics/metrics-filter-context";
import {
  dayKeysInRange,
  rangeToIso,
  shortDayLabel,
} from "@/lib/metrics/period";
import { formatPercent } from "@/lib/metrics/format";
import { channelMeta } from "@/lib/metrics/channels";
import { exportToCsv } from "@/lib/export/csv";
import {
  aggregateAgentsIa,
  type AgentsIaAutomationRow,
  type AgentsIaChannelRow,
  type AgentsIaConfig,
  type AgentsIaFlowRow,
  type AgentsIaResult,
  type AiAutomationLogRow,
  type AiConversationRow,
  type AiFlowRunRow,
  type AiMessageRow,
  type AiNamedOption,
} from "@/lib/metrics/agents-ia";

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  deepseek: "DeepSeek",
  groq: "Groq",
};

function normalizeChannel(channel: string | null | undefined): string {
  const value = (channel ?? "").trim();
  return value || "whatsapp";
}

export default function AgentesIaMetricsPage() {
  const supabase = createClient();
  const { accountId, profileLoading } = useAuth();
  const { applied, range } = useMetricsFilters();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentsIaResult | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const { fromIso, toIsoExclusive } = rangeToIso(range);

      const [msgRes, convRes, runRes, logRes, flowRes, autoRes, cfgRes] =
        await Promise.all([
          supabase
            .from("messages")
            .select("conversation_id, sender_type, sender_id, channel, created_at")
            .gte("created_at", fromIso)
            .lt("created_at", toIsoExclusive)
            .limit(50000),
          supabase
            .from("conversations")
            .select("id, channel, ai_reply_count, ai_autoreply_disabled")
            .eq("account_id", accountId)
            .limit(50000),
          supabase
            .from("flow_runs")
            .select("flow_id, status, started_at")
            .eq("account_id", accountId)
            .gte("started_at", fromIso)
            .lt("started_at", toIsoExclusive)
            .limit(50000),
          supabase
            .from("automation_logs")
            .select("automation_id, status, created_at")
            .eq("account_id", accountId)
            .gte("created_at", fromIso)
            .lt("created_at", toIsoExclusive)
            .limit(50000),
          supabase
            .from("flows")
            .select("id, name")
            .eq("account_id", accountId)
            .limit(20000),
          supabase
            .from("automations")
            .select("id, name")
            .eq("account_id", accountId)
            .limit(20000),
          supabase
            .from("ai_configs")
            .select(
              "provider, model, fallback_model, is_active, auto_reply_enabled, auto_reply_max_per_conversation"
            )
            .eq("account_id", accountId)
            .maybeSingle(),
        ]);

      const firstError =
        msgRes.error ?? convRes.error ?? runRes.error ?? logRes.error;
      if (firstError) throw new Error(firstError.message);

      let messages = (msgRes.data ?? []) as unknown as AiMessageRow[];
      let conversations = (convRes.data ?? []) as unknown as AiConversationRow[];
      const flowRuns = (runRes.data ?? []) as unknown as AiFlowRunRow[];
      const automationLogs = (logRes.data ?? []) as unknown as AiAutomationLogRow[];
      const flows = (flowRes.data ?? []) as unknown as AiNamedOption[];
      const automations = (autoRes.data ?? []) as unknown as AiNamedOption[];

      // ---- Filtro de canal ------------------------------------
      if (applied.channel !== "all") {
        const convChannel = new Map<string, string>();
        for (const c of conversations) {
          convChannel.set(c.id, normalizeChannel(c.channel));
        }
        messages = messages.filter((m) => {
          const ch = m.channel
            ? normalizeChannel(m.channel)
            : convChannel.get(m.conversation_id) ?? "whatsapp";
          return ch === applied.channel;
        });
        conversations = conversations.filter(
          (c) => normalizeChannel(c.channel) === applied.channel
        );
      }

      const rawConfig = cfgRes.data as
        | {
            provider: string;
            model: string;
            fallback_model: string | null;
            is_active: boolean;
            auto_reply_enabled: boolean;
            auto_reply_max_per_conversation: number;
          }
        | null;
      const config: AgentsIaConfig | null = rawConfig
        ? {
            provider: rawConfig.provider,
            model: rawConfig.model,
            fallbackModel: rawConfig.fallback_model,
            isActive: rawConfig.is_active,
            autoReplyEnabled: rawConfig.auto_reply_enabled,
            maxPerConversation: rawConfig.auto_reply_max_per_conversation,
          }
        : null;

      setResult(
        aggregateAgentsIa({
          messages,
          conversations,
          flowRuns,
          automationLogs,
          flows,
          automations,
          config,
          dayKeys: dayKeysInRange(range),
        })
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudieron cargar las métricas."
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [accountId, applied, range, supabase]);

  useEffect(() => {
    if (profileLoading || !accountId) return;
    load();
  }, [accountId, profileLoading, load]);

  if (loading) return <AgentsIaSkeleton />;
  if (error)
    return (
      <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  if (!result) return null;

  const { totals, config } = result;

  const chartData = result.series.map((p) => ({
    day: shortDayLabel(p.day),
    Bot: p.bot,
    Agentes: p.agent,
  }));
  const hasSeries = result.series.some((p) => p.bot > 0 || p.agent > 0);

  const donutSlices = [
    { label: "Clientes", value: totals.customerMessages, color: "#64748b" },
    { label: "Agentes", value: totals.agentMessages, color: "#3b82f6" },
    { label: "Bot / IA", value: totals.botMessages, color: "#a855f7" },
  ];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          title="Respuestas automáticas"
          value={totals.botMessages.toLocaleString("es-ES")}
          icon={Bot}
          subtitle={`${totals.agentMessages.toLocaleString("es-ES")} de agentes`}
        />
        <MetricCard
          title="Conversaciones con IA"
          value={totals.botConversations.toLocaleString("es-ES")}
          icon={MessagesSquare}
          subtitle="Con respuesta del bot"
        />
        <MetricCard
          title="% atención automatizada"
          value={formatPercent(totals.automationShare)}
          icon={Percent}
          subtitle="Bot / (bot + agentes)"
        />
        <MetricCard
          title="Flujos ejecutados"
          value={totals.flowRuns.toLocaleString("es-ES")}
          icon={Workflow}
          subtitle={`${totals.flowsCompleted} completados · ${totals.flowsActive} activos`}
        />
        <MetricCard
          title="Automatizaciones"
          value={totals.automationRuns.toLocaleString("es-ES")}
          icon={Zap}
          subtitle={`${totals.automationFailed} con error`}
        />
        <MetricCard
          title="Derivaciones a humano"
          value={totals.handoffs.toLocaleString("es-ES")}
          icon={UserRoundCheck}
          subtitle="IA desactivada en el hilo"
        />
      </div>

      {/* Actividad automatizada */}
      <Panel
        title="Actividad automatizada"
        subtitle="Mensajes por día (bot / IA frente a agentes)"
      >
        {!hasSeries ? (
          <EmptyState
            icon={Bot}
            title="Sin actividad"
            hint="No hay mensajes del bot ni de agentes en el período."
          />
        ) : (
          <BarChart
            data={chartData}
            index="day"
            categories={["Bot", "Agentes"]}
            colors={["violet", "blue"]}
            allowDecimals={false}
            className="h-[280px]"
          />
        )}
      </Panel>

      {/* Composición + Estado del asistente */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Composición de mensajes"
          subtitle="Quién envió los mensajes del período"
        >
          {totals.customerMessages +
            totals.agentMessages +
            totals.botMessages ===
          0 ? (
            <EmptyState
              icon={MessagesSquare}
              title="Sin mensajes"
              hint="No hay mensajes en el período seleccionado."
            />
          ) : (
            <Donut
              slices={donutSlices}
              centerLabel={formatPercent(totals.automationShare)}
              centerSub="atención IA"
            />
          )}
        </Panel>

        <Panel
          title="Estado del asistente IA"
          subtitle="Configuración del asistente de la cuenta"
        >
          {!config ? (
            <EmptyState
              icon={Sparkles}
              title="Sin configurar"
              hint="Aún no hay un asistente de IA configurado en este espacio."
            />
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <ConfigItem
                label="Proveedor"
                value={PROVIDER_LABEL[config.provider] ?? config.provider}
              />
              <ConfigItem label="Modelo" value={config.model} />
              <ConfigItem
                label="Modelo de respaldo"
                value={config.fallbackModel || "—"}
              />
              <ConfigItem
                label="Máx. respuestas por conversación"
                value={String(config.maxPerConversation)}
              />
              <ConfigItem
                label="Asistente"
                value={config.isActive ? "Activo" : "Inactivo"}
                accent={config.isActive}
              />
              <ConfigItem
                label="Auto-respuesta"
                value={config.autoReplyEnabled ? "Activada" : "Desactivada"}
                accent={config.autoReplyEnabled}
              />
            </dl>
          )}
        </Panel>
      </div>

      {/* Flujos */}
      <Panel
        title="Flujos"
        subtitle="Ejecuciones iniciadas en el período"
        bodyClassName="p-0"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportFlows(result.flows)}
            disabled={result.flows.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        }
      >
        <FlowsTable rows={result.flows} />
      </Panel>

      {/* Automatizaciones */}
      <Panel
        title="Automatizaciones"
        subtitle="Ejecuciones registradas en el período"
        bodyClassName="p-0"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportAutomations(result.automations)}
            disabled={result.automations.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        }
      >
        <AutomationsTable rows={result.automations} />
      </Panel>

      {/* Canales */}
      <Panel
        title="Respuestas del bot por canal"
        subtitle="Dónde responde la IA y los flujos"
        bodyClassName="p-0"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportChannels(result.channels)}
            disabled={result.channels.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        }
      >
        <ChannelsTable rows={result.channels} />
      </Panel>
    </div>
  );
}

function ConfigItem({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          accent === undefined
            ? "mt-0.5 font-medium text-foreground"
            : accent
            ? "mt-0.5 font-medium text-emerald-400"
            : "mt-0.5 font-medium text-muted-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function exportFlows(rows: AgentsIaFlowRow[]) {
  exportToCsv(
    "agentes-ia-flujos.csv",
    [
      "Flujo",
      "Ejecuciones",
      "Completados",
      "Derivados",
      "Activos",
      "Expirados",
      "Fallidos",
      "Tasa de finalización",
    ],
    rows.map((r) => [
      r.name,
      String(r.runs),
      String(r.completed),
      String(r.handedOff),
      String(r.active),
      String(r.timedOut),
      String(r.failed),
      formatPercent(r.completionRate),
    ])
  );
}

function exportAutomations(rows: AgentsIaAutomationRow[]) {
  exportToCsv(
    "agentes-ia-automatizaciones.csv",
    ["Automatización", "Ejecuciones", "Éxito", "Parcial", "Fallo", "Tasa de éxito"],
    rows.map((r) => [
      r.name,
      String(r.runs),
      String(r.success),
      String(r.partial),
      String(r.failed),
      formatPercent(r.successRate),
    ])
  );
}

function exportChannels(rows: AgentsIaChannelRow[]) {
  exportToCsv(
    "agentes-ia-canales.csv",
    ["Canal", "Respuestas del bot", "Conversaciones"],
    rows.map((r) => [
      channelMeta(r.channel).label,
      String(r.botMessages),
      String(r.conversations),
    ])
  );
}

function FlowsTable({ rows }: { rows: AgentsIaFlowRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-5 py-3 font-medium">Flujo</th>
            <th className="px-3 py-3 text-right font-medium">Ejecuciones</th>
            <th className="px-3 py-3 text-right font-medium">Completados</th>
            <th className="px-3 py-3 text-right font-medium">Derivados</th>
            <th className="px-3 py-3 text-right font-medium">Activos</th>
            <th className="px-5 py-3 text-right font-medium">
              Tasa de finalización
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-5 py-10 text-center text-sm text-muted-foreground"
              >
                Sin ejecuciones de flujos en el período.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.key}
                className="border-b border-border last:border-0 hover:bg-muted/40"
              >
                <td className="px-5 py-3 font-medium text-foreground">
                  {r.name}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.runs.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-foreground">
                  {r.completed.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.handedOff.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.active.toLocaleString("es-ES")}
                </td>
                <td className="px-5 py-3 text-right tabular-nums font-medium text-foreground">
                  {formatPercent(r.completionRate)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function AutomationsTable({ rows }: { rows: AgentsIaAutomationRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-5 py-3 font-medium">Automatización</th>
            <th className="px-3 py-3 text-right font-medium">Ejecuciones</th>
            <th className="px-3 py-3 text-right font-medium">Éxito</th>
            <th className="px-3 py-3 text-right font-medium">Parcial</th>
            <th className="px-3 py-3 text-right font-medium">Fallo</th>
            <th className="px-5 py-3 text-right font-medium">Tasa de éxito</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-5 py-10 text-center text-sm text-muted-foreground"
              >
                Sin ejecuciones de automatizaciones en el período.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.key}
                className="border-b border-border last:border-0 hover:bg-muted/40"
              >
                <td className="px-5 py-3 font-medium text-foreground">
                  {r.name}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.runs.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-foreground">
                  {r.success.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.partial.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.failed.toLocaleString("es-ES")}
                </td>
                <td className="px-5 py-3 text-right tabular-nums font-medium text-foreground">
                  {formatPercent(r.successRate)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ChannelsTable({ rows }: { rows: AgentsIaChannelRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-5 py-3 font-medium">Canal</th>
            <th className="px-3 py-3 text-right font-medium">
              Respuestas del bot
            </th>
            <th className="px-5 py-3 text-right font-medium">Conversaciones</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={3}
                className="px-5 py-10 text-center text-sm text-muted-foreground"
              >
                Sin respuestas automáticas en el período.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.channel}
                className="border-b border-border last:border-0 hover:bg-muted/40"
              >
                <td className="px-5 py-3 font-medium text-foreground">
                  {channelMeta(r.channel).label}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-foreground">
                  {r.botMessages.toLocaleString("es-ES")}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                  {r.conversations.toLocaleString("es-ES")}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function AgentsIaSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[320px] rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-[220px] rounded-xl" />
        <Skeleton className="h-[220px] rounded-xl" />
      </div>
      <Skeleton className="h-[260px] rounded-xl" />
    </div>
  );
}
