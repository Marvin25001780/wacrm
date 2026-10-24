"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BarChart3,
  Download,
  Handshake,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { Panel } from "@/components/metrics/panel";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { agingRows } from "@/lib/collections/aging";
import { exportToCsv } from "@/lib/export/csv";
import {
  formatDate,
  formatPercent,
  formatUsd,
  todayIso,
} from "@/lib/collections/format";
import {
  COLLECTION_PROMISE_STATUSES,
  labelFor,
  type CollectionAgingRow,
  type CollectionAgentPerformanceRow,
  type CollectionCommissionRow,
  type CollectionDailyRecoveryRow,
  type CollectionPromiseStatsRow,
} from "@/types/collections";
import { cn } from "@/lib/utils";

function sinceIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export default function ReportesPage() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [aging, setAging] = useState<CollectionAgingRow | null>(null);
  const [promiseStats, setPromiseStats] = useState<CollectionPromiseStatsRow[]>([]);
  const [recovery, setRecovery] = useState<CollectionDailyRecoveryRow[]>([]);
  const [agents, setAgents] = useState<CollectionAgentPerformanceRow[]>([]);
  const [commissions, setCommissions] = useState<CollectionCommissionRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const since = sinceIso(30);
    const sinceMonth = `${todayIso().slice(0, 7)}-01`;

    const [agingRes, promisesRes, recoveryRes, agentsRes, commissionsRes, profilesRes] =
      await Promise.all([
        supabase.from("v_collection_aging").select("*").maybeSingle(),
        supabase.from("v_collection_promise_stats").select("*"),
        supabase
          .from("v_collection_daily_recovery")
          .select("*")
          .gte("paid_at", since)
          .order("paid_at", { ascending: false }),
        supabase.from("v_collection_agent_performance").select("*"),
        supabase
          .from("v_collection_commissions")
          .select("*")
          .gte("month", sinceMonth)
          .limit(200),
        supabase.from("profiles").select("id, full_name, email"),
      ]);

    setLoading(false);

    if (agingRes.error || promisesRes.error || recoveryRes.error || agentsRes.error) {
      console.error("[cobranza/reportes] load error", {
        aging: agingRes.error,
        promises: promisesRes.error,
        recovery: recoveryRes.error,
        agents: agentsRes.error,
      });
      toast.error("No se pudieron cargar los reportes");
      return;
    }

    setAging((agingRes.data ?? null) as CollectionAgingRow | null);
    setPromiseStats((promisesRes.data ?? []) as CollectionPromiseStatsRow[]);
    setRecovery((recoveryRes.data ?? []) as CollectionDailyRecoveryRow[]);
    setAgents((agentsRes.data ?? []) as CollectionAgentPerformanceRow[]);
    setCommissions((commissionsRes.data ?? []) as CollectionCommissionRow[]);

    const profileMap: Record<string, string> = {};
    for (const profile of profilesRes.data ?? []) {
      profileMap[profile.id as string] =
        (profile.full_name as string | null) ?? (profile.email as string | null) ?? "Usuario";
    }
    setProfiles(profileMap);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, accountId]);

  const buckets = useMemo(
    () => ({
      current: Number(aging?.current ?? 0),
      d1_30: Number(aging?.d1_30 ?? 0),
      d31_60: Number(aging?.d31_60 ?? 0),
      d61_90: Number(aging?.d61_90 ?? 0),
      d90_plus: Number(aging?.d90_plus ?? 0),
      total:
        Number(aging?.current ?? 0) +
        Number(aging?.d1_30 ?? 0) +
        Number(aging?.d31_60 ?? 0) +
        Number(aging?.d61_90 ?? 0) +
        Number(aging?.d90_plus ?? 0),
    }),
    [aging],
  );

  const summary = useMemo(() => {
    const recovered = recovery.reduce((sum, row) => sum + Number(row.recovered || 0), 0);
    const pending = promiseStats
      .filter((row) => row.status === "pending" || row.status === "partial")
      .reduce((sum, row) => sum + Number(row.count || 0), 0);
    const kept = promiseStats
      .filter((row) => row.status === "kept")
      .reduce((sum, row) => sum + Number(row.count || 0), 0);
    const broken = promiseStats
      .filter((row) => row.status === "broken")
      .reduce((sum, row) => sum + Number(row.count || 0), 0);
    const partial = promiseStats
      .filter((row) => row.status === "partial")
      .reduce((sum, row) => sum + Number(row.count || 0), 0);
    const resolved = kept + broken + partial;

    return {
      total: buckets.total,
      overdue: buckets.total - buckets.current,
      recovered,
      pending,
      kept,
      broken,
      partial,
      effectiveness: resolved > 0 ? (kept / resolved) * 100 : 0,
      commission: commissions.reduce((sum, row) => sum + Number(row.commission || 0), 0),
      payments: recovery.reduce((sum, row) => sum + Number(row.payments || 0), 0),
    };
  }, [buckets, commissions, promiseStats, recovery]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
        <SkeletonCard className="h-80" />
      </div>
    );
  }

  const hasData = buckets.total > 0 || recovery.length > 0 || promiseStats.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Reportes de cobranza</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aging, recuperación, acuerdos y productividad de los últimos 30 días.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              exportToCsv(
                "aging-cobranza.csv",
                ["Tramo", "Saldo USD"],
                agingRows(buckets).map((row) => [row.label, row.value.toFixed(2)]),
              )
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Aging CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              exportToCsv(
                "recuperacion-cobranza.csv",
                ["Fecha", "Pagos", "Recuperado USD"],
                recovery.map((row) => [
                  row.paid_at,
                  String(row.payments),
                  Number(row.recovered || 0).toFixed(2),
                ]),
              )
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Recuperación CSV
          </Button>
        </div>
      </div>

      {!hasData ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <EmptyState
            icon={BarChart3}
            title="Sin datos para reportar"
            hint="Cuando existan deudores, cuotas y pagos, aquí verás el aging, la recuperación y el cumplimiento de PTP."
          />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Cartera total"
              value={formatUsd(summary.total)}
              icon={Wallet}
              subtitle="Saldo pendiente"
            />
            <MetricCard
              title="Cartera vencida"
              value={formatUsd(summary.overdue)}
              icon={AlertTriangle}
              subtitle={
                summary.total > 0
                  ? `${((summary.overdue / summary.total) * 100).toFixed(1)}% del total`
                  : "Sin saldo"
              }
            />
            <MetricCard
              title="Recuperado 30 días"
              value={formatUsd(summary.recovered)}
              icon={TrendingUp}
              subtitle={`${summary.payments} pagos`}
            />
            <MetricCard
              title="Efectividad PTP"
              value={formatPercent(summary.effectiveness)}
              icon={Handshake}
              subtitle={`${summary.kept} cumplidas · ${summary.broken} rotas`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Aging de cartera" subtitle="Distribución del saldo por mora">
              <div className="space-y-3">
                {agingRows(buckets).map((row) => {
                  const pct = buckets.total > 0 ? (row.value / buckets.total) * 100 : 0;
                  return (
                    <div key={row.key}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{row.label}</span>
                        <span className="font-medium tabular-nums">{formatUsd(row.value)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              row.key === "current"
                                ? "bg-sky-400"
                                : row.key === "d1_30"
                                  ? "bg-cyan-400"
                                  : row.key === "d31_60"
                                    ? "bg-amber-400"
                                    : "bg-red-400",
                            )}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Acuerdos de pago" subtitle="Estado de las PTP">
              <div className="space-y-2">
                {COLLECTION_PROMISE_STATUSES.map((status) => {
                  const row = promiseStats.find((item) => item.status === status.value);
                  const count = Number(row?.count ?? 0);
                  const amount = Number(row?.amount ?? 0);
                  return (
                    <div
                      key={status.value}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{status.label}</p>
                        <p className="text-xs text-muted-foreground">{count} acuerdos</p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums">{formatUsd(amount)}</p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Pendientes: {summary.pending} · Comisión estimada del mes:{" "}
                {formatUsd(summary.commission)}
              </p>
            </Panel>
          </div>

          <Panel title="Recuperación diaria" subtitle="Pagos de los últimos 30 días">
            {recovery.length === 0 ? (
              <EmptyState icon={Wallet} title="Sin pagos en los últimos 30 días" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Pagos</TableHead>
                    <TableHead className="text-right">Recuperado</TableHead>
                    <TableHead className="text-right">Promedio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recovery.map((row) => (
                    <TableRow key={row.paid_at}>
                      <TableCell>{formatDate(row.paid_at)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.payments}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-300">
                        {formatUsd(row.recovered)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatUsd(Number(row.recovered) / Math.max(Number(row.payments), 1))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Productividad por gestor" subtitle="Gestiones de los últimos 30 días">
              {agents.length === 0 ? (
                <EmptyState icon={BarChart3} title="Sin gestiones registradas" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Gestor</TableHead>
                      <TableHead className="text-right">Gestiones</TableHead>
                      <TableHead className="text-right">Contacto</TableHead>
                      <TableHead className="text-right">PTP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agents.map((row) => (
                      <TableRow key={row.user_id}>
                        <TableCell className="font-medium">
                          {profiles[row.user_id] ?? "Usuario"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.actions}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.actions > 0
                            ? formatPercent((row.contacted / row.actions) * 100)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.promises_created}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>

            <Panel title="Comisiones del mes" subtitle="Cálculo según reglas por tramo">
              {commissions.length === 0 ? (
                <EmptyState
                  icon={Handshake}
                  title="Sin comisiones calculadas"
                  hint="Configura el porcentaje por tramo en Políticas."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Gestor</TableHead>
                      <TableHead>Mes</TableHead>
                      <TableHead className="text-right">Recuperado</TableHead>
                      <TableHead className="text-right">Comisión</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commissions.map((row, index) => (
                      <TableRow key={`${row.user_id ?? "none"}-${row.month}-${index}`}>
                        <TableCell className="font-medium">
                          {row.user_id ? (profiles[row.user_id] ?? "Usuario") : "Sin asignar"}
                        </TableCell>
                        <TableCell>{row.month}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatUsd(row.recovered)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-300">
                          {formatUsd(row.commission)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
