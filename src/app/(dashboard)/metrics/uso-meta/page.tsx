"use client";

// ============================================================
// Métricas · Uso de Meta
//
// Actividad de los canales de Meta (WhatsApp, Instagram Direct y
// Facebook Messenger): volumen de mensajes, entrantes/salientes,
// plantillas enviadas, fallos de entrega y el estado de conexión de
// cada canal.
//
// Filtros: se respeta el rango de tiempo y el filtro de canal; si el
// canal elegido no es de Meta, la sección queda vacía a propósito.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  MessageSquare,
  Send,
  Inbox,
  FileText,
  AlertTriangle,
  XCircle,
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
  aggregateMetaUsage,
  isMetaChannel,
  META_CHANNELS,
  type MetaChannel,
  type MetaChannelRow,
  type MetaConversationRow,
  type MetaMessageRow,
  type MetaUsageResult,
  type MetaTemplateRow,
} from "@/lib/metrics/meta-usage";

interface ChannelConfigLite {
  channel: string;
  is_active: boolean;
  config: Record<string, unknown> | null;
}

interface WhatsappConfigLite {
  status: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  connected_at: string | null;
  last_registration_error: string | null;
}

type ConnectionState = "connected" | "inactive" | "disconnected";

interface ConnectionInfo {
  channel: MetaChannel;
  state: ConnectionState;
  detail: string;
}

export default function UsoMetaMetricsPage() {
  const supabase = createClient();
  const { accountId, profileLoading } = useAuth();
  const { applied, range } = useMetricsFilters();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MetaUsageResult | null>(null);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const { fromIso, toIsoExclusive } = rangeToIso(range);

      const [msgRes, convRes] = await Promise.all([
        supabase
          .from("messages")
          .select(
            "conversation_id, sender_type, channel, content_type, template_name, status, created_at"
          )
          .gte("created_at", fromIso)
          .lt("created_at", toIsoExclusive)
          .limit(50000),
        supabase
          .from("conversations")
          .select("id, channel, created_at")
          .eq("account_id", accountId)
          .gte("created_at", fromIso)
          .lt("created_at", toIsoExclusive)
          .limit(50000),
      ]);

      if (msgRes.error) throw new Error(msgRes.error.message);
      if (convRes.error) throw new Error(convRes.error.message);

      const messages = (msgRes.data ?? []) as unknown as MetaMessageRow[];
      const conversations = (convRes.data ?? []) as unknown as MetaConversationRow[];

      const allowedChannels: MetaChannel[] =
        applied.channel === "all"
          ? [...META_CHANNELS]
          : isMetaChannel(applied.channel)
          ? [applied.channel]
          : [];

      setResult(
        aggregateMetaUsage({
          messages,
          conversations,
          dayKeys: dayKeysInRange(range),
          allowedChannels,
        })
      );

      // ---- Estado de conexión (no fatal si falla) ---------------
      const [cfgRes, waRes] = await Promise.all([
        supabase.from("channel_configs").select("channel, is_active, config"),
        supabase
          .from("whatsapp_config")
          .select(
            "status, phone_number_id, waba_id, connected_at, last_registration_error"
          )
          .eq("account_id", accountId)
          .limit(1)
          .maybeSingle(),
      ]);
      setConnections(
        buildConnections(
          (cfgRes.data ?? []) as unknown as ChannelConfigLite[],
          (waRes.data ?? null) as unknown as WhatsappConfigLite | null
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
  }, [accountId, applied.channel, range, supabase]);

  useEffect(() => {
    if (profileLoading || !accountId) return;
    load();
  }, [accountId, profileLoading, load]);

  if (loading) return <UsoMetaSkeleton />;
  if (error)
    return (
      <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  if (!result) return null;

  const { totals } = result;

  const chartData = result.series.map((p) => ({
    day: shortDayLabel(p.day),
    WhatsApp: p.whatsapp,
    Instagram: p.instagram,
    Facebook: p.facebook,
  }));
  const hasSeries = result.series.some(
    (p) => p.whatsapp > 0 || p.instagram > 0 || p.facebook > 0
  );

  const donutSlices = result.channels.map((row) => {
    const meta = channelMeta(row.channel);
    return {
      label: meta.label,
      value: row.messages,
      color: channelColor(row.channel),
    };
  });

  const deliveryRate =
    totals.delivered + totals.failed > 0
      ? totals.delivered / (totals.delivered + totals.failed)
      : null;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          title="Mensajes Meta"
          value={totals.messages.toLocaleString("es-ES")}
          icon={MessageSquare}
          subtitle={`${totals.incoming.toLocaleString(
            "es-ES"
          )} entrantes · ${totals.outgoing.toLocaleString("es-ES")} salientes`}
        />
        <MetricCard
          title="Conversaciones"
          value={totals.conversations.toLocaleString("es-ES")}
          icon={Inbox}
          subtitle={`${totals.newConversations.toLocaleString("es-ES")} nuevas`}
        />
        <MetricCard
          title="Mensajes recibidos"
          value={totals.incoming.toLocaleString("es-ES")}
          icon={Inbox}
          subtitle="De clientes"
        />
        <MetricCard
          title="Mensajes enviados"
          value={totals.outgoing.toLocaleString("es-ES")}
          icon={Send}
          subtitle="De agentes y bot"
        />
        <MetricCard
          title="Plantillas enviadas"
          value={totals.templates.toLocaleString("es-ES")}
          icon={FileText}
          subtitle={
            totals.messages > 0
              ? `${formatPercent(totals.templates / totals.messages)} del total`
              : "Sin envíos"
          }
        />
        <MetricCard
          title="Fallidos"
          value={totals.failed.toLocaleString("es-ES")}
          icon={AlertTriangle}
          subtitle={
            deliveryRate == null
              ? "Sin datos de entrega"
              : `entrega ${formatPercent(deliveryRate)}`
          }
        />
      </div>

      {/* Series */}
      <Panel
        title="Mensajes por canal y día"
        subtitle="Volumen diario en los canales de Meta"
      >
        {!hasSeries ? (
          <EmptyState
            icon={MessageSquare}
            title="Sin actividad"
            hint="No hay mensajes de Meta en el período seleccionado."
          />
        ) : (
          <BarChart
            data={chartData}
            index="day"
            categories={["WhatsApp", "Instagram", "Facebook"]}
            colors={["emerald", "pink", "blue"]}
            allowDecimals={false}
            className="h-[300px]"
          />
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Distribución por canal"
          subtitle="Reparto de mensajes entre los canales de Meta"
        >
          {totals.messages === 0 ? (
            <EmptyState
              icon={Send}
              title="Sin mensajes"
              hint="No hay mensajes en el período seleccionado."
            />
          ) : (
            <Donut
              slices={donutSlices}
              centerLabel={totals.messages.toLocaleString("es-ES")}
              centerSub="mensajes"
            />
          )}
        </Panel>

        <Panel
          title="Conexión de canales Meta"
          subtitle="Estado actual de cada integración"
        >
          <ul className="divide-y divide-border">
            {connections.map((c) => {
              const meta = channelMeta(c.channel);
              const Icon = meta.icon;
              return (
                <li
                  key={c.channel}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${meta.tint}`}
                  >
                    {meta.logoSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={meta.logoSrc}
                        alt=""
                        className="h-4 w-4"
                      />
                    ) : (
                      <Icon className={`h-4 w-4 ${meta.color}`} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {meta.label}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.detail}
                    </p>
                  </div>
                  <ConnectionBadge state={c.state} />
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      {/* Uso por canal */}
      <Panel
        title="Uso por canal"
        subtitle="Detalle de mensajes de Meta en el período"
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

      {/* Plantillas */}
      <Panel
        title="Plantillas más usadas"
        subtitle="Plantillas de Meta enviadas en el período"
        bodyClassName="p-0"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportTemplates(result.templates)}
            disabled={result.templates.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        }
      >
        <TemplatesTable rows={result.templates} />
      </Panel>
    </div>
  );
}

function buildConnections(
  configs: ChannelConfigLite[],
  wa: WhatsappConfigLite | null
): ConnectionInfo[] {
  const byChannel = new Map<string, ChannelConfigLite>();
  for (const c of configs) byChannel.set(c.channel, c);

  const pageId = (cfg: ChannelConfigLite | undefined): string => {
    const value = cfg?.config?.page_id;
    return typeof value === "string" && value ? value : "";
  };

  // WhatsApp: Cloud API (whatsapp_config) o Evolution.
  const evolution = byChannel.get("evolution");
  let whatsappState: ConnectionState = "disconnected";
  let whatsappDetail = "Sin conectar";
  if (wa && wa.status === "connected") {
    whatsappState = "connected";
    whatsappDetail = wa.phone_number_id
      ? `Meta Cloud API · ${wa.phone_number_id}`
      : "Meta Cloud API";
  } else if (evolution?.is_active) {
    whatsappState = "connected";
    whatsappDetail = "Evolution API (WhatsApp no oficial)";
  } else if (wa || evolution) {
    whatsappState = "inactive";
    whatsappDetail = wa?.last_registration_error
      ? wa.last_registration_error
      : "Configurado pero inactivo";
  }

  const ig = byChannel.get("instagram");
  const fb = byChannel.get("facebook");

  const stateOf = (cfg: ChannelConfigLite | undefined): ConnectionState =>
    !cfg ? "disconnected" : cfg.is_active ? "connected" : "inactive";

  const detailOf = (
    cfg: ChannelConfigLite | undefined,
    connected: string,
    idle: string
  ): string => {
    if (!cfg) return "Sin conectar";
    const id = pageId(cfg);
    if (cfg.is_active) return id ? `${connected} · ${id}` : connected;
    return id ? `${id} · ${idle}` : idle;
  };

  return [
    { channel: "whatsapp", state: whatsappState, detail: whatsappDetail },
    {
      channel: "instagram",
      state: stateOf(ig),
      detail: detailOf(ig, "Instagram Direct conectado", "Conectado, inactivo"),
    },
    {
      channel: "facebook",
      state: stateOf(fb),
      detail: detailOf(fb, "Messenger conectado", "Conectado, inactivo"),
    },
  ];
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  if (state === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        Conectado
      </span>
    );
  }
  if (state === "inactive") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
        <AlertTriangle className="h-3 w-3" />
        Inactivo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <XCircle className="h-3 w-3" />
      Sin conectar
    </span>
  );
}

function channelColor(channel: MetaChannel): string {
  switch (channel) {
    case "whatsapp":
      return "#34d399";
    case "instagram":
      return "#f472b6";
    case "facebook":
      return "#60a5fa";
    default:
      return "#94a3b8";
  }
}

function exportChannels(rows: MetaChannelRow[]) {
  exportToCsv(
    "uso-meta-canales.csv",
    [
      "Canal",
      "Conversaciones",
      "Mensajes",
      "Entrantes",
      "Salientes",
      "Plantillas",
      "Fallidos",
    ],
    rows.map((r) => [
      channelMeta(r.channel).label,
      String(r.conversations),
      String(r.messages),
      String(r.incoming),
      String(r.outgoing),
      String(r.templates),
      String(r.failed),
    ])
  );
}

function exportTemplates(rows: MetaTemplateRow[]) {
  exportToCsv(
    "uso-meta-plantillas.csv",
    ["Plantilla", "Envíos", "Canales"],
    rows.map((r) => [
      r.name,
      String(r.count),
      r.channels.map((c) => channelMeta(c).label).join(" / "),
    ])
  );
}

function ChannelsTable({ rows }: { rows: MetaChannelRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-5 py-3 font-medium">Canal</th>
            <th className="px-3 py-3 text-right font-medium">Conversaciones</th>
            <th className="px-3 py-3 text-right font-medium">Mensajes</th>
            <th className="px-3 py-3 text-right font-medium">Entrantes</th>
            <th className="px-3 py-3 text-right font-medium">Salientes</th>
            <th className="px-3 py-3 text-right font-medium">Plantillas</th>
            <th className="px-5 py-3 text-right font-medium">Fallidos</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="px-5 py-10 text-center text-sm text-muted-foreground"
              >
                Sin actividad de Meta en el período.
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const meta = channelMeta(r.channel);
              const Icon = meta.icon;
              return (
                <tr
                  key={r.channel}
                  className="border-b border-border last:border-0 hover:bg-muted/40"
                >
                  <td className="px-5 py-3 font-medium text-foreground">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full ${meta.tint}`}
                      >
                        <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                      </span>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                    {r.conversations.toLocaleString("es-ES")}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-foreground">
                    {r.messages.toLocaleString("es-ES")}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                    {r.incoming.toLocaleString("es-ES")}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                    {r.outgoing.toLocaleString("es-ES")}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                    {r.templates.toLocaleString("es-ES")}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {r.failed.toLocaleString("es-ES")}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function TemplatesTable({ rows }: { rows: MetaTemplateRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-5 py-3 font-medium">Plantilla</th>
            <th className="px-3 py-3 text-right font-medium">Envíos</th>
            <th className="px-5 py-3 font-medium">Canales</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={3}
                className="px-5 py-10 text-center text-sm text-muted-foreground"
              >
                <span className="inline-flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  No se enviaron plantillas en el período.
                </span>
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.name}
                className="border-b border-border last:border-0 hover:bg-muted/40"
              >
                <td className="px-5 py-3 font-medium text-foreground">
                  {r.name}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-foreground">
                  {r.count.toLocaleString("es-ES")}
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {r.channels.map((c) => channelMeta(c).label).join(" / ")}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function UsoMetaSkeleton() {
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
