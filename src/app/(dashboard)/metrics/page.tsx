"use client";

// ============================================================
// Métricas de mensajería — módulo de métricas (multicanal).
//
// Panel que agrega los mensajes de la cuenta en enviados, recibidos
// y respondidos, y los desglosa por CANAL (WhatsApp, correo,
// webchat, Instagram, Facebook, TikTok, Telegram) y por AGENTE.
//
// La agregación es pura (`@/lib/metrics/aggregate`) y se calcula en
// el cliente sobre las filas del período; RLS acota todo a la cuenta.
// Los canales sin integración activa aparecen en cero, listos para
// iluminarse en cuanto empiecen a generar tráfico.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Inbox,
  Percent,
  Reply,
  Send,
  Timer,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { BarChart } from "@/components/tremor/bar-chart";
import { CHANNEL_CATALOG, channelMeta } from "@/lib/metrics/channels";
import { ChannelIcon } from "@/components/channels/channel-icon";
import {
  aggregateMessaging,
  formatDuration,
  METRIC_PERIODS,
  periodStartIso,
  type MessagingMessageRow,
  type MessagingProfile,
  type MetricPeriodKey,
} from "@/lib/metrics/aggregate";

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export default function MetricsPage() {
  const supabase = createClient();
  const { accountId, profileLoading } = useAuth();

  const [period, setPeriod] = useState<MetricPeriodKey>("30");
  const [rows, setRows] = useState<MessagingMessageRow[]>([]);
  const [profiles, setProfiles] = useState<MessagingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (key: MetricPeriodKey) => {
      setLoading(true);
      setError(null);
      try {
        const since = periodStartIso(key);
        const [msgRes, profRes] = await Promise.all([
          supabase
            .from("messages")
            .select("conversation_id, sender_type, sender_id, channel, created_at")
            .gte("created_at", since)
            .order("created_at", { ascending: true })
            .limit(20000),
          supabase.from("profiles").select("id, user_id, full_name, email"),
        ]);

        if (msgRes.error) throw new Error(msgRes.error.message);
        if (profRes.error) throw new Error(profRes.error.message);

        setRows((msgRes.data ?? []) as unknown as MessagingMessageRow[]);
        setProfiles((profRes.data ?? []) as unknown as MessagingProfile[]);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar las métricas."
        );
        setRows([]);
        setProfiles([]);
      } finally {
        setLoading(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    if (profileLoading || !accountId) return;
    load(period);
  }, [accountId, profileLoading, period, load]);

  const days = METRIC_PERIODS.find((p) => p.key === period)?.days ?? 30;
  const result = useMemo(
    () => aggregateMessaging(rows, profiles, days),
    [rows, profiles, days]
  );

  const byChannel = useMemo(
    () => new Map(result.channels.map((c) => [c.channel, c])),
    [result.channels]
  );

  const hasActivity = result.totals.sent + result.totals.received > 0;
  const totalAgentSent = result.agents.reduce((sum, a) => sum + a.sent, 0);

  const chartData = result.series.map((p) => ({
    day: shortDayLabel(p.day),
    Entrantes: p.incoming,
    Salientes: p.outgoing,
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Métricas de mensajería</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mensajes enviados, recibidos y respondidos por canal y por agente.
          </p>
        </div>
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {METRIC_PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors " +
                (period === p.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <MetricsSkeleton />
      ) : error ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              title="Enviados"
              value={String(result.totals.sent)}
              icon={Send}
              subtitle="Mensajes salientes"
            />
            <MetricCard
              title="Recibidos"
              value={String(result.totals.received)}
              icon={Inbox}
              subtitle="Mensajes entrantes"
            />
            <MetricCard
              title="Respondidos"
              value={String(result.totals.replied)}
              icon={Reply}
              subtitle="Entrantes con respuesta"
            />
            <MetricCard
              title="Tasa de respuesta"
              value={pct(result.totals.responseRate)}
              icon={Percent}
              subtitle="Respondidos / recibidos"
            />
            <MetricCard
              title="1ª respuesta"
              value={formatDuration(result.totals.avgFirstResponseMin)}
              icon={Timer}
              subtitle="Promedio del período"
            />
            <MetricCard
              title="Agentes activos"
              value={String(result.totals.activeAgents)}
              icon={Users}
              subtitle="Con envíos atribuidos"
            />
          </div>

          {/* Desglose por canal */}
          <div>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Por canal</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {CHANNEL_CATALOG.map((meta) => {
                const m = byChannel.get(meta.key);
                const connected = !!m && m.sent + m.received > 0;
                return (
                  <div
                    key={meta.key}
                    className="rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={
                            "flex size-9 shrink-0 items-center justify-center rounded-lg " +
                            meta.tint +
                            " " +
                            meta.color
                          }
                        >
                          <ChannelIcon meta={meta} size={18} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {meta.label}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {connected ? "Conectado" : meta.hint}
                          </p>
                        </div>
                      </div>
                      <span
                        className={
                          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium " +
                          (connected
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-muted text-muted-foreground")
                        }
                      >
                        {connected ? pct(m?.responseRate ?? 0) : "Sin datos"}
                      </span>
                    </div>

                    {connected ? (
                      <>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                          <ChannelStat label="Enviados" value={m?.sent ?? 0} />
                          <ChannelStat label="Recibidos" value={m?.received ?? 0} />
                          <ChannelStat label="Respondidos" value={m?.replied ?? 0} />
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          1ª respuesta {formatDuration(m?.avgFirstResponseMin ?? null)}
                        </p>
                      </>
                    ) : (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Sin actividad en el período.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tendencia diaria */}
          <section className="rounded-xl border border-border bg-card">
            <header className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">
                Mensajes por día
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Volumen diario entrante y saliente
              </p>
            </header>
            <div className="p-5">
              {!hasActivity ? (
                <EmptyState
                  icon={Inbox}
                  title="Sin actividad de mensajes en el período"
                  hint="Envía o recibe mensajes para empezar a poblar este gráfico."
                />
              ) : (
                <BarChart
                  data={chartData}
                  index="day"
                  categories={["Entrantes", "Salientes"]}
                  colors={["blue", "violet"]}
                  valueFormatter={(v) => v.toLocaleString("es-ES")}
                  yAxisWidth={44}
                  className="h-[260px]"
                />
              )}
            </div>
          </section>

          {/* Ranking por agente */}
          <div>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Por agente</h2>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Agente</th>
                    <th className="px-3 py-3 text-center font-medium">Enviados</th>
                    <th className="px-3 py-3 text-center font-medium">Conversaciones</th>
                    <th className="px-4 py-3 text-right font-medium">% del total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.agents.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-10 text-center text-sm text-muted-foreground"
                      >
                        Aún no hay envíos atribuidos a un agente en el período.
                      </td>
                    </tr>
                  ) : (
                    result.agents.map((a) => (
                      <tr
                        key={a.profileId}
                        className="border-b border-border last:border-0 hover:bg-muted/40"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                              {a.fullName.charAt(0).toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">
                                {a.fullName}
                              </p>
                              {a.email && (
                                <p className="truncate text-xs text-muted-foreground">
                                  {a.email}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center font-medium text-foreground">
                          {a.sent}
                        </td>
                        <td className="px-3 py-3 text-center text-foreground">
                          {a.conversations}
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {totalAgentSent > 0
                            ? pct(a.sent / totalAgentSent)
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              La atribución usa el autor del envío. Un mensaje saliente sin autor
              (bot, automatización o API) no aparece en el ranking.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Subcomponentes
// ------------------------------------------------------------
function ChannelStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 py-2">
      <p className="text-base font-bold text-foreground tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function MetricsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[132px] w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[340px] w-full rounded-xl" />
    </div>
  );
}

function shortDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("es-ES", { month: "short", day: "numeric" });
}
