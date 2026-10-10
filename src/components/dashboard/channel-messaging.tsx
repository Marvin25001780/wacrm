"use client"

// ============================================================
// Widget "Mensajería por canal" del Panel — estilo Kommo.
//
// Muestra, por canal habilitado (WhatsApp, SMS, Instagram…), los
// mensajes RECIBIDOS / ENVIADOS / RESPONDIDOS del período como un
// gráfico de barras agrupadas. Reutiliza el agregador puro del módulo
// de métricas, así que el desglose es idéntico al de la página
// /metrics.
//
// Un canal se considera "habilitado" cuando genera mensajes en el
// período: aparece en el gráfico automáticamente. Los que aún no
// tienen tráfico se listan abajo como "por habilitar", de modo que
// conectar SMS/Instagram/TikTok solo requiere empezar a escribir en
// `messages` con ese `channel`.
// ============================================================

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Inbox, Reply, Send } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { cn } from "@/lib/utils"
import { BarChart } from "@/components/tremor/bar-chart"
import { EmptyState } from "@/components/dashboard/empty-state"
import { Skeleton } from "@/components/dashboard/skeleton"
import { CHANNEL_CATALOG, channelMeta } from "@/lib/metrics/channels"
import {
  aggregateMessaging,
  METRIC_PERIODS,
  periodStartIso,
  type MessagingMessageRow,
  type MessagingProfile,
  type MessagingResult,
  type MetricPeriodKey,
} from "@/lib/metrics/aggregate"

export function ChannelMessaging() {
  const supabase = createClient()
  const { accountId, profileLoading } = useAuth()

  const [period, setPeriod] = useState<MetricPeriodKey>("30")
  const [result, setResult] = useState<MessagingResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (key: MetricPeriodKey) => {
      setLoading(true)
      setError(null)
      try {
        const days = METRIC_PERIODS.find((p) => p.key === key)?.days ?? 30
        const since = periodStartIso(key)
        const [msgRes, profRes] = await Promise.all([
          supabase
            .from("messages")
            .select("conversation_id, sender_type, sender_id, channel, created_at")
            .gte("created_at", since)
            .order("created_at", { ascending: true })
            .limit(20000),
          supabase.from("profiles").select("id, user_id, full_name, email"),
        ])
        if (msgRes.error) throw new Error(msgRes.error.message)
        if (profRes.error) throw new Error(profRes.error.message)

        setResult(
          aggregateMessaging(
            (msgRes.data ?? []) as unknown as MessagingMessageRow[],
            (profRes.data ?? []) as unknown as MessagingProfile[],
            days
          )
        )
      } catch (err) {
        console.error("[channel-messaging] failed:", err)
        setError(
          err instanceof Error ? err.message : "No se pudo cargar el desglose."
        )
        setResult(null)
      } finally {
        setLoading(false)
      }
    },
    [supabase]
  )

  useEffect(() => {
    if (profileLoading || !accountId) return
    load(period)
  }, [accountId, profileLoading, period, load])

  const active = result?.channels ?? []
  const activeKeys = new Set(active.map((c) => c.channel))
  const pending = CHANNEL_CATALOG.filter((c) => !activeKeys.has(c.key))

  const chartData = active.map((c) => ({
    canal: channelMeta(c.channel).label,
    Recibidos: c.received,
    Enviados: c.sent,
    Respondidos: c.replied,
  }))

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Mensajería por canal
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Recibidos, enviados y respondidos por canal
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-muted/60 p-1">
            {METRIC_PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  period === p.key
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Link
            href="/metrics"
            className="hidden items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:flex"
          >
            Ver detalle
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </header>

      <div className="p-5">
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : error ? (
          <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            {error}
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Sin actividad por canal en el período"
            hint="Cuando lleguen o salgan mensajes, cada canal aparecerá aquí con su desglose."
          />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <SummaryStat
                icon={Inbox}
                label="Recibidos"
                value={result?.totals.received ?? 0}
                tone="text-blue-400"
              />
              <SummaryStat
                icon={Send}
                label="Enviados"
                value={result?.totals.sent ?? 0}
                tone="text-violet-400"
              />
              <SummaryStat
                icon={Reply}
                label="Respondidos"
                value={result?.totals.replied ?? 0}
                tone="text-emerald-400"
              />
            </div>
            <BarChart
              data={chartData}
              index="canal"
              categories={["Recibidos", "Enviados", "Respondidos"]}
              colors={["blue", "violet", "emerald"]}
              valueFormatter={(v) => v.toLocaleString("es-ES")}
              yAxisWidth={44}
              allowDecimals={false}
              className="h-[300px]"
            />
          </>
        )}
      </div>

      {!loading && !error && pending.length > 0 && (
        <footer className="border-t border-border px-5 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Canales por habilitar
            </p>
            <Link
              href="/channels"
              className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Gestionar canales
              <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pending.map((c) => {
              const Icon = c.icon
              return (
                <span
                  key={c.key}
                  title={c.hint}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
                >
                  <Icon className={cn("size-3", c.color)} />
                  {c.label}
                </span>
              )
            })}
          </div>
        </footer>
      )}
    </section>
  )
}

// ------------------------------------------------------------

function SummaryStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Inbox
  label: string
  value: number
  tone: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <span className={cn("flex size-8 items-center justify-center rounded-md bg-muted", tone)}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-base font-bold leading-none text-foreground tabular-nums">
          {value.toLocaleString("es-ES")}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}
