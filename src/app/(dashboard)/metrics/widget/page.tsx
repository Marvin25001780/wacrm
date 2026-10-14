"use client";

// ============================================================
// Métricas · Widget (webchat)
//
// Rendimiento del widget de chat del sitio web: conversaciones
// iniciadas, mensajes, tiempo de primera respuesta, tasa de atención
// y el detalle de cada conversación. Se apoya en el canal `webchat`.
//
// Filtros: se respeta el rango de tiempo; si el filtro de canal apunta
// a otro canal distinto de webchat, la sección queda vacía.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  Download,
  Gauge,
  Globe,
  MessageCircle,
  MessagesSquare,
  Percent,
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
import { formatMinutes, formatPercent } from "@/lib/metrics/format";
import { exportToCsv } from "@/lib/export/csv";
import {
  aggregateWidget,
  type WidgetConfig,
  type WidgetContactRow,
  type WidgetConversationRow,
  type WidgetMessageRow,
  type WidgetResult,
  type WidgetConversationTableRow,
} from "@/lib/metrics/widget";

const STATUS_LABEL: Record<string, string> = {
  open: "Abierta",
  closed: "Cerrada",
  pending: "Pendiente",
  snoozed: "Pospuesta",
};

function statusLabel(status: string | null): string {
  if (!status) return "—";
  return STATUS_LABEL[status] ?? status;
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WidgetMetricsPage() {
  const supabase = createClient();
  const { accountId, profileLoading } = useAuth();
  const { applied, range } = useMetricsFilters();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WidgetResult | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const { fromIso, toIsoExclusive } = rangeToIso(range);

      const [msgRes, convRes, cfgRes] = await Promise.all([
        supabase
          .from("messages")
          .select("conversation_id, sender_type, created_at")
          .eq("channel", "webchat")
          .gte("created_at", fromIso)
          .lt("created_at", toIsoExclusive)
          .limit(50000),
        supabase
          .from("conversations")
          .select("id, created_at, contact_id, status")
          .eq("account_id", accountId)
          .eq("channel", "webchat")
          .limit(50000),
        supabase
          .from("webchat_configs")
          .select("enabled, title, welcome_message, color, position")
          .eq("account_id", accountId)
          .maybeSingle(),
      ]);

      if (msgRes.error) throw new Error(msgRes.error.message);
      if (convRes.error) throw new Error(convRes.error.message);

      const messages = (msgRes.data ?? []) as unknown as WidgetMessageRow[];
      const conversations = (convRes.data ?? []) as unknown as WidgetConversationRow[];

      // Nombres de los contactos referenciados por las conversaciones.
      const contactIds = Array.from(
        new Set(
          conversations
            .map((c) => c.contact_id)
            .filter((id): id is string => Boolean(id))
        )
      );
      let contacts: WidgetContactRow[] = [];
      if (contactIds.length > 0) {
        const { data } = await supabase
          .from("contacts")
          .select("id, name")
          .in("id", contactIds.slice(0, 5000));
        contacts = (data ?? []) as unknown as WidgetContactRow[];
      }

      const rawConfig = cfgRes.data as
        | {
            enabled: boolean;
            title: string;
            welcome_message: string | null;
            color: string;
            position: string;
          }
        | null;
      const config: WidgetConfig | null = rawConfig
        ? {
            enabled: rawConfig.enabled,
            title: rawConfig.title,
            welcomeMessage: rawConfig.welcome_message,
            color: rawConfig.color,
            position: rawConfig.position,
          }
        : null;

      const allowed =
        applied.channel === "all" || applied.channel === "webchat";

      setResult(
        aggregateWidget({
          messages,
          conversations,
          contacts,
          dayKeys: dayKeysInRange(range),
          config,
          allowed,
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
  }, [accountId, applied.channel, range, supabase]);

  useEffect(() => {
    if (profileLoading || !accountId) return;
    load();
  }, [accountId, profileLoading, load]);

  if (loading) return <WidgetSkeleton />;
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
    Entrantes: p.incoming,
    Salientes: p.outgoing,
  }));
  const hasSeries = result.series.some(
    (p) => p.incoming > 0 || p.outgoing > 0
  );

  const donutSlices = [
    { label: "Entrantes", value: totals.incoming, color: "#38bdf8" },
    { label: "Salientes", value: totals.outgoing, color: "#a855f7" },
  ];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          title="Conversaciones"
          value={totals.conversations.toLocaleString("es-ES")}
          icon={MessagesSquare}
          subtitle={`${totals.newConversations.toLocaleString("es-ES")} nuevas`}
        />
        <MetricCard
          title="Mensajes"
          value={totals.messages.toLocaleString("es-ES")}
          icon={MessageCircle}
          subtitle={`${totals.incoming.toLocaleString(
            "es-ES"
          )} entrantes · ${totals.outgoing.toLocaleString("es-ES")} salientes`}
        />
        <MetricCard
          title="Tiempo de 1ª respuesta"
          value={formatMinutes(totals.avgFirstResponseMinutes)}
          icon={Clock}
          subtitle="cliente → respuesta"
        />
        <MetricCard
          title="Tasa de respuesta"
          value={formatPercent(totals.responseRate)}
          icon={Percent}
          subtitle="conversaciones atendidas"
        />
        <MetricCard
          title="Mensajes por conversación"
          value={
            totals.messagesPerConversation == null
              ? "—"
              : totals.messagesPerConversation.toLocaleString("es-ES", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })
          }
          icon={MessagesSquare}
          subtitle="promedio del período"
        />
        <MetricCard
          title="Conversaciones nuevas"
          value={totals.newConversations.toLocaleString("es-ES")}
          icon={Globe}
          subtitle="iniciadas desde el widget"
        />
      </div>

      {/* Series */}
      <Panel
        title="Actividad del widget"
        subtitle="Mensajes por día (entrantes y salientes)"
      >
        {!hasSeries ? (
          <EmptyState
            icon={Globe}
            title="Sin actividad"
            hint="No hay conversaciones del widget en el período seleccionado."
          />
        ) : (
          <BarChart
            data={chartData}
            index="day"
            categories={["Entrantes", "Salientes"]}
            colors={["cyan", "violet"]}
            allowDecimals={false}
            className="h-[300px]"
          />
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Reparto de mensajes"
          subtitle="Entrantes del visitante frente a respuestas"
        >
          {totals.messages === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title="Sin mensajes"
              hint="No hay mensajes del widget en el período."
            />
          ) : (
            <Donut
              slices={donutSlices}
              centerLabel={formatPercent(totals.responseRate)}
              centerSub="con respuesta"
            />
          )}
        </Panel>

        <Panel
          title="Estado del widget"
          subtitle="Configuración del chat del sitio web"
        >
          {!config ? (
            <EmptyState
              icon={Globe}
              title="Sin configurar"
              hint="Aún no has creado el widget de chat del sitio web."
            />
          ) : (
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Estado</span>
                {config.enabled ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                    <Gauge className="h-3 w-3" />
                    Activo
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Inactivo
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Título</span>
                <span className="font-medium text-foreground">
                  {config.title}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Posición</span>
                <span className="font-medium text-foreground">
                  {config.position === "bottom-left"
                    ? "Abajo a la izquierda"
                    : "Abajo a la derecha"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Color</span>
                <span className="inline-flex items-center gap-2 font-medium text-foreground">
                  <span
                    className="h-4 w-4 rounded-full border border-border"
                    style={{ backgroundColor: config.color }}
                  />
                  {config.color}
                </span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Mensaje de bienvenida
                </p>
                <p className="mt-0.5 text-sm text-foreground">
                  {config.welcomeMessage || "—"}
                </p>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Conversaciones */}
      <Panel
        title="Conversaciones"
        subtitle="Hilos iniciados desde el widget en el período"
        bodyClassName="p-0"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportConversations(result.conversations)}
            disabled={result.conversations.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        }
      >
        <ConversationsTable rows={result.conversations} />
      </Panel>
    </div>
  );
}

function exportConversations(rows: WidgetConversationTableRow[]) {
  exportToCsv(
    "widget-conversaciones.csv",
    [
      "Contacto",
      "Mensajes",
      "Entrantes",
      "Primera respuesta (min)",
      "Estado",
      "Último mensaje",
    ],
    rows.map((r) => [
      r.contactName,
      String(r.messages),
      String(r.incoming),
      r.firstResponseMinutes == null
        ? ""
        : r.firstResponseMinutes.toFixed(1),
      statusLabel(r.status),
      r.lastMessageAt,
    ])
  );
}

function ConversationsTable({ rows }: { rows: WidgetConversationTableRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-5 py-3 font-medium">Contacto</th>
            <th className="px-3 py-3 text-right font-medium">Mensajes</th>
            <th className="px-3 py-3 text-right font-medium">Entrantes</th>
            <th className="px-3 py-3 text-right font-medium">
              1ª respuesta
            </th>
            <th className="px-3 py-3 font-medium">Estado</th>
            <th className="px-5 py-3 font-medium">Último mensaje</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-5 py-10 text-center text-sm text-muted-foreground"
              >
                <span className="inline-flex items-center gap-2">
                  <MessageCircle className="h-4 w-4" />
                  Sin conversaciones del widget en el período.
                </span>
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border last:border-0 hover:bg-muted/40"
              >
                <td className="px-5 py-3 font-medium text-foreground">
                  {r.contactName}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-foreground">
                  {r.messages.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.incoming.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.firstResponseMinutes == null
                    ? "—"
                    : formatMinutes(r.firstResponseMinutes)}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {statusLabel(r.status)}
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {formatDateTime(r.lastMessageAt)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[340px] rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-[240px] rounded-xl" />
        <Skeleton className="h-[240px] rounded-xl" />
      </div>
      <Skeleton className="h-[260px] rounded-xl" />
    </div>
  );
}
