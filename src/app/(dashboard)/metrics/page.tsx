"use client";

// ============================================================
// Métricas · Conversaciones.
//
//   • KPIs (activas, nuevas, enviados, recibidos)
//   • barras de conversaciones activas y nuevas por día
//   • mapas de calor 7×24 de horas pico (entrantes / salientes)
//   • barras apiladas de mensajes enviados vs recibidos
//   • ranking de etiquetas de conversación
//   • motivos de cierre
//   • tabla resumen por canal con exportación CSV
//
// La agregación es pura (`@/lib/metrics/conversations`) y se calcula
// en el cliente sobre las filas del período; RLS acota todo a la
// cuenta y los filtros se aplican antes de agregar.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  Inbox,
  MessageSquare,
  Reply,
  Send,
  Tag,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { Panel } from "@/components/metrics/panel";
import { Heatmap } from "@/components/metrics/heatmap";
import { BarChart } from "@/components/tremor/bar-chart";
import { Button } from "@/components/ui/button";
import { CHANNEL_CATALOG, channelMeta } from "@/lib/metrics/channels";
import { useMetricsFilters } from "@/components/metrics/metrics-filter-context";
import {
  dayKeysInRange,
  rangeToIso,
  shortDayLabel,
} from "@/lib/metrics/period";
import { exportToCsv } from "@/lib/export/csv";
import {
  aggregateConversations,
  type ConversationsResult,
  type MetricsConversationRow,
  type MetricsMessageRow,
  type MetricsTagLinkRow,
} from "@/lib/metrics/conversations";

const CONVERSATION_SELECT =
  "id, contact_id, assigned_agent_id, channel, status, created_at, last_message_at, closed_at, close_reason";

const CHANNEL_INTEGRATION: Record<string, string> = {
  whatsapp: "Meta Cloud API",
  sms: "textbee",
  email: "Correo",
  webchat: "Demo Webchat",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  telegram: "Telegram",
};

function normalizeChannel(channel: string | null | undefined): string {
  const value = (channel ?? "").trim();
  return value || "whatsapp";
}

export default function ConversationsMetricsPage() {
  const supabase = createClient();
  const { accountId, profileLoading } = useAuth();
  const { applied, range, agents } = useMetricsFilters();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConversationsResult | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const { fromIso, toIsoExclusive } = rangeToIso(range);

      const [msgRes, convActRes, convNewRes, tagRes] = await Promise.all([
        supabase
          .from("messages")
          .select("conversation_id, sender_type, sender_id, channel, created_at")
          .gte("created_at", fromIso)
          .lt("created_at", toIsoExclusive)
          .order("created_at", { ascending: true })
          .limit(20000),
        supabase
          .from("conversations")
          .select(CONVERSATION_SELECT)
          .gte("last_message_at", fromIso)
          .lt("last_message_at", toIsoExclusive)
          .limit(20000),
        supabase
          .from("conversations")
          .select(CONVERSATION_SELECT)
          .gte("created_at", fromIso)
          .lt("created_at", toIsoExclusive)
          .limit(20000),
        supabase
          .from("conversation_tags")
          .select("conversation_id, created_at, tag:tags(id, name, color)")
          .gte("created_at", fromIso)
          .lt("created_at", toIsoExclusive)
          .limit(20000),
      ]);

      if (msgRes.error) throw new Error(msgRes.error.message);

      // Une conversaciones activas + nuevas (sin duplicados).
      const convMap = new Map<string, MetricsConversationRow>();
      for (const c of [
        ...((convActRes.data ?? []) as unknown as MetricsConversationRow[]),
        ...((convNewRes.data ?? []) as unknown as MetricsConversationRow[]),
      ]) {
        convMap.set(c.id, c);
      }
      let conversations = [...convMap.values()];
      let messages = (msgRes.data ?? []) as unknown as MetricsMessageRow[];

      const channelById = new Map<string, string>();
      for (const c of conversations) {
        channelById.set(c.id, normalizeChannel(c.channel));
      }

      // ---- Filtro por agente ------------------------------------
      if (applied.agentId !== "all") {
        const agent = agents.find((a) => a.id === applied.agentId);
        const ids = new Set<string>([applied.agentId]);
        if (agent?.userId) ids.add(agent.userId);
        conversations = conversations.filter(
          (c) => c.assigned_agent_id && ids.has(c.assigned_agent_id)
        );
      }

      // ---- Filtro por equipo ------------------------------------
      if (applied.teamId !== "all") {
        const { data: members } = await supabase
          .from("team_members")
          .select("profile_id")
          .eq("team_id", applied.teamId);
        const memberIds = new Set(
          ((members ?? []) as Array<{ profile_id: string }>).map(
            (m) => m.profile_id
          )
        );
        conversations = conversations.filter(
          (c) => c.assigned_agent_id && memberIds.has(c.assigned_agent_id)
        );
      }

      const hasConvFilter =
        applied.agentId !== "all" ||
        applied.teamId !== "all" ||
        applied.channel !== "all";

      // ---- Filtro por canal -------------------------------------
      if (applied.channel !== "all") {
        conversations = conversations.filter(
          (c) => normalizeChannel(c.channel) === applied.channel
        );
      }

      if (hasConvFilter) {
        const allowed = new Set(conversations.map((c) => c.id));
        messages = messages.filter((m) => allowed.has(m.conversation_id));
      }
      if (applied.channel !== "all") {
        messages = messages.filter(
          (m) =>
            normalizeChannel(
              m.channel ?? channelById.get(m.conversation_id)
            ) === applied.channel
        );
      }

      // ---- Filtro por tipo (entrante / saliente) ----------------
      if (applied.type === "incoming") {
        messages = messages.filter((m) => m.sender_type === "customer");
      } else if (applied.type === "outgoing") {
        messages = messages.filter((m) => m.sender_type !== "customer");
      }

      // ---- Etiquetas de conversación ----------------------------
      let tagLinks = tagRes.error
        ? []
        : ((tagRes.data ?? []) as unknown as MetricsTagLinkRow[]);
      if (hasConvFilter) {
        const allowed = new Set(conversations.map((c) => c.id));
        tagLinks = tagLinks.filter((t) => allowed.has(t.conversation_id));
      }

      setResult(
        aggregateConversations(
          conversations,
          messages,
          tagLinks,
          dayKeysInRange(range)
        )
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
  }, [accountId, applied, range, agents, supabase]);

  useEffect(() => {
    if (profileLoading || !accountId) return;
    load();
  }, [accountId, profileLoading, load]);

  const activeChart = (result?.series ?? []).map((p) => ({
    day: shortDayLabel(p.day),
    Activas: p.active,
  }));
  const createdChart = (result?.series ?? []).map((p) => ({
    day: shortDayLabel(p.day),
    Nuevas: p.created,
  }));
  const messagesChart = (result?.series ?? []).map((p) => ({
    day: shortDayLabel(p.day),
    Enviados: p.sent,
    Recibidos: p.received,
  }));
  const labelsChart = (result?.labels ?? []).slice(0, 8).map((l) => ({
    name: l.name,
    Etiquetas: l.count,
  }));
  const reasonsChart = (result?.closeReasons ?? []).slice(0, 8).map((r) => ({
    name: r.reason,
    Cierres: r.count,
  }));

  function channelRow(channel: string) {
    return (
      result?.channels.find((c) => c.channel === channel) ?? {
        channel,
        active: 0,
        created: 0,
        sent: 0,
        received: 0,
      }
    );
  }

  function handleExport() {
    if (!result) return;
    exportToCsv(
      "metricas-conversaciones.csv",
      [
        "Canal",
        "Integración",
        "Conversaciones activas",
        "Nuevas conversaciones",
        "Mensajes enviados",
        "Mensajes recibidos",
      ],
      CHANNEL_CATALOG.map((channel) => {
        const row = channelRow(channel.key);
        return [
          channel.label,
          CHANNEL_INTEGRATION[channel.key] ?? channel.label,
          String(row.active),
          String(row.created),
          String(row.sent),
          String(row.received),
        ];
      })
    );
  }

  return (
    <div className="space-y-5">
      {loading ? (
        <ConversationsSkeleton />
      ) : error ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : !result ? null : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              title="Conversaciones activas"
              value={result.totals.active.toLocaleString("es-ES")}
              icon={Inbox}
              subtitle="Con mensajes en el período"
            />
            <MetricCard
              title="Nuevas conversaciones"
              value={result.totals.created.toLocaleString("es-ES")}
              icon={MessageSquare}
              subtitle="Iniciadas en el período"
            />
            <MetricCard
              title="Mensajes enviados"
              value={result.totals.sent.toLocaleString("es-ES")}
              icon={Send}
              subtitle="Salientes"
            />
            <MetricCard
              title="Mensajes recibidos"
              value={result.totals.received.toLocaleString("es-ES")}
              icon={Reply}
              subtitle="Entrantes"
            />
          </div>

          {/* Barras: activas / nuevas */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel
              title="Conversaciones activas"
              subtitle="Hilos con mensajes por día"
            >
              {result.totals.active === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title="Sin conversaciones activas"
                  hint="Ajusta los filtros o el rango de tiempo."
                />
              ) : (
                <BarChart
                  data={activeChart}
                  index="day"
                  categories={["Activas"]}
                  colors={["emerald"]}
                  valueFormatter={(v) => v.toLocaleString("es-ES")}
                  yAxisWidth={40}
                  allowDecimals={false}
                  className="h-[240px]"
                />
              )}
            </Panel>

            <Panel
              title="Nuevas conversaciones"
              subtitle="Conversaciones iniciadas por día"
            >
              {result.totals.created === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  title="Sin conversaciones nuevas"
                  hint="Ajusta los filtros o el rango de tiempo."
                />
              ) : (
                <BarChart
                  data={createdChart}
                  index="day"
                  categories={["Nuevas"]}
                  colors={["blue"]}
                  valueFormatter={(v) => v.toLocaleString("es-ES")}
                  yAxisWidth={40}
                  allowDecimals={false}
                  className="h-[240px]"
                />
              )}
            </Panel>
          </div>

          {/* Horas pico */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel
              title="Horas pico — mensajes entrantes"
              subtitle="Distribución por día de la semana y hora"
              bodyClassName="overflow-x-auto"
            >
              <Heatmap matrix={result.heatmapIncoming} rgb={[16, 185, 129]} />
            </Panel>
            <Panel
              title="Horas pico — mensajes salientes"
              subtitle="Distribución por día de la semana y hora"
              bodyClassName="overflow-x-auto"
            >
              <Heatmap matrix={result.heatmapOutgoing} rgb={[139, 92, 246]} />
            </Panel>
          </div>

          {/* Enviados vs recibidos */}
          <Panel
            title="Mensajes enviados vs recibidos"
            subtitle={`Volumen diario · ${(
              result.totals.sent + result.totals.received
            ).toLocaleString("es-ES")} mensajes en total`}
          >
            {result.totals.sent + result.totals.received === 0 ? (
              <EmptyState
                icon={Inbox}
                title="Sin mensajes en el período"
                hint="Ajusta los filtros o el rango de tiempo."
              />
            ) : (
              <BarChart
                data={messagesChart}
                index="day"
                categories={["Enviados", "Recibidos"]}
                colors={["blue", "violet"]}
                type="stacked"
                valueFormatter={(v) => v.toLocaleString("es-ES")}
                yAxisWidth={44}
                allowDecimals={false}
                className="h-[260px]"
              />
            )}
          </Panel>

          {/* Etiquetas + Motivos de cierre */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel
              title="Etiquetas de conversación"
              subtitle="Las etiquetas más usadas en el período"
            >
              {labelsChart.length === 0 ? (
                <EmptyState
                  icon={Tag}
                  title="Sin etiquetas en el período"
                  hint="Etiqueta conversaciones en la Bandeja para verlas aquí."
                />
              ) : (
                <BarChart
                  data={labelsChart}
                  index="name"
                  categories={["Etiquetas"]}
                  colors={["pink"]}
                  layout="vertical"
                  valueFormatter={(v) => v.toLocaleString("es-ES")}
                  yAxisWidth={110}
                  allowDecimals={false}
                  className="h-[280px]"
                />
              )}
            </Panel>

            <Panel
              title="Motivos de cierre"
              subtitle="Cómo terminaron las conversaciones cerradas"
            >
              {reasonsChart.length === 0 ? (
                <EmptyState
                  icon={XCircle}
                  title="Sin motivos de cierre"
                  hint="Aún no hay conversaciones cerradas con motivo en el período."
                />
              ) : (
                <BarChart
                  data={reasonsChart}
                  index="name"
                  categories={["Cierres"]}
                  colors={["amber"]}
                  layout="vertical"
                  valueFormatter={(v) => v.toLocaleString("es-ES")}
                  yAxisWidth={110}
                  allowDecimals={false}
                  className="h-[280px]"
                />
              )}
            </Panel>
          </div>

          {/* Tabla resumen por canal */}
          <Panel
            title="Resumen por canal"
            subtitle="Actividad del período agrupada por canal"
            bodyClassName="p-0"
            actions={
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Exportar CSV
              </Button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Canal</th>
                    <th className="px-3 py-3 font-medium">Integración</th>
                    <th className="px-3 py-3 text-right font-medium">
                      Conversaciones activas
                    </th>
                    <th className="px-3 py-3 text-right font-medium">
                      Nuevas conversaciones
                    </th>
                    <th className="px-3 py-3 text-right font-medium">
                      Mensajes enviados
                    </th>
                    <th className="px-5 py-3 text-right font-medium">
                      Mensajes recibidos
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CHANNEL_CATALOG.map((channel) => {
                    const row = channelRow(channel.key);
                    const meta = channelMeta(channel.key);
                    const Icon = meta.icon;
                    return (
                      <tr
                        key={channel.key}
                        className="border-b border-border last:border-0 hover:bg-muted/40"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`flex size-7 items-center justify-center rounded-lg ${meta.tint} ${meta.color}`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="font-medium text-foreground">
                              {meta.label}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {CHANNEL_INTEGRATION[channel.key] ?? channel.label}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-foreground">
                          {row.active.toLocaleString("es-ES")}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-foreground">
                          {row.created.toLocaleString("es-ES")}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                          {row.sent.toLocaleString("es-ES")}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                          {row.received.toLocaleString("es-ES")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function ConversationsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[300px] w-full rounded-xl" />
      <Skeleton className="h-[300px] w-full rounded-xl" />
    </div>
  );
}
