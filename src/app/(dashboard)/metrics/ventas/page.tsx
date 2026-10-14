"use client";

// ============================================================
// Métricas · Ventas
//
// KPIs de ventas y cotizaciones, serie diaria (vendido / cotizado),
// embudo por etapa y tablas por agente, equipo y producto, además del
// registro de ventas del período. Cada tabla exporta a CSV.
//
// Definiciones:
//   • cotización → oferta creada dentro del período
//   • venta      → oferta ganada, contada por `closed_at`
//   • abierta    → oferta con estado distinto de won/lost (embudo)
//
// Se traen las ofertas creadas en el período ∪ las cerradas en el
// período y se agregan en una función pura (`aggregateSales`). Los
// filtros de agente/equipo se aplican antes de agregar.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  DollarSign,
  FileText,
  ShoppingCart,
  Target,
  Trophy,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { Panel } from "@/components/metrics/panel";
import { BarChart } from "@/components/tremor/bar-chart";
import { Button } from "@/components/ui/button";
import { useMetricsFilters } from "@/components/metrics/metrics-filter-context";
import {
  dayKeysInRange,
  rangeToIso,
  shortDayLabel,
} from "@/lib/metrics/period";
import { formatCurrency } from "@/lib/currency";
import { formatPercent } from "@/lib/metrics/format";
import { exportToCsv } from "@/lib/export/csv";
import {
  aggregateSales,
  type SalesContactRow,
  type SalesDealRow,
  type SalesProfileOption,
  type SalesResult,
  type SalesStageRow,
  type SalesTableRow,
  type SalesTeamMemberRow,
  type SalesTeamOption,
} from "@/lib/metrics/sales";

const DEAL_SELECT =
  "id, title, value, currency, status, product, assigned_to, pipeline_id, stage_id, contact_id, created_at, closed_at";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SalesMetricsPage() {
  const supabase = createClient();
  const { accountId, profileLoading, defaultCurrency } = useAuth();
  const { applied, range, agents, teams } = useMetricsFilters();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SalesResult | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const { fromIso, toIsoExclusive } = rangeToIso(range);

      const [createdRes, closedRes, memberRes, stageRes, contactRes] =
        await Promise.all([
          supabase
            .from("deals")
            .select(DEAL_SELECT)
            .gte("created_at", fromIso)
            .lt("created_at", toIsoExclusive)
            .limit(20000),
          supabase
            .from("deals")
            .select(DEAL_SELECT)
            .gte("closed_at", fromIso)
            .lt("closed_at", toIsoExclusive)
            .limit(20000),
          supabase
            .from("team_members")
            .select("team_id, profile_id")
            .eq("account_id", accountId)
            .limit(20000),
          supabase
            .from("pipeline_stages")
            .select("id, name, position, color")
            .limit(20000),
          supabase.from("contacts").select("id, name").limit(20000),
        ]);

      const firstError = createdRes.error ?? closedRes.error;
      if (firstError) throw new Error(firstError.message);

      // Une ofertas creadas + cerradas en el período (sin duplicados).
      const dealMap = new Map<string, SalesDealRow>();
      for (const d of [
        ...((createdRes.data ?? []) as unknown as SalesDealRow[]),
        ...((closedRes.data ?? []) as unknown as SalesDealRow[]),
      ]) {
        dealMap.set(d.id, d);
      }
      let deals = [...dealMap.values()];

      const profileOptions: SalesProfileOption[] = agents.map((a) => ({
        id: a.id,
        userId: a.userId,
        name: a.name,
      }));
      const teamOptions: SalesTeamOption[] = teams.map((t) => ({
        id: t.id,
        name: t.name,
      }));
      const members: SalesTeamMemberRow[] = memberRes.error
        ? []
        : ((memberRes.data ?? []) as Array<{
            team_id: string;
            profile_id: string;
          }>).map((m) => ({ teamId: m.team_id, profileId: m.profile_id }));
      const stages: SalesStageRow[] = stageRes.error
        ? []
        : ((stageRes.data ?? []) as Array<{
            id: string;
            name: string;
            position: number;
            color: string | null;
          }>).map((s) => ({
            id: s.id,
            name: s.name,
            position: s.position,
            color: s.color,
          }));
      const contacts: SalesContactRow[] = contactRes.error
        ? []
        : ((contactRes.data ?? []) as Array<{
            id: string;
            name: string | null;
          }>).map((c) => ({ id: c.id, name: c.name }));

      // ---- Filtros (agente / equipo) ---------------------------
      if (applied.agentId !== "all") {
        const agent = agents.find((a) => a.id === applied.agentId);
        const ids = new Set<string>([applied.agentId]);
        if (agent?.userId) ids.add(agent.userId);
        deals = deals.filter((d) => d.assigned_to && ids.has(d.assigned_to));
      }
      if (applied.teamId !== "all") {
        const memberIds = new Set(
          members
            .filter((m) => m.teamId === applied.teamId)
            .map((m) => m.profileId)
        );
        const memberUserIds = new Set(
          agents
            .filter((a) => memberIds.has(a.id))
            .map((a) => a.userId ?? a.id)
        );
        deals = deals.filter(
          (d) =>
            d.assigned_to &&
            (memberIds.has(d.assigned_to) || memberUserIds.has(d.assigned_to))
        );
      }

      setResult(
        aggregateSales(
          deals,
          profileOptions,
          teamOptions,
          members,
          stages,
          contacts,
          dayKeysInRange(range),
          defaultCurrency
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
  }, [accountId, applied, range, agents, teams, defaultCurrency, supabase]);

  useEffect(() => {
    if (profileLoading || !accountId) return;
    load();
  }, [accountId, profileLoading, load]);

  if (loading) return <SalesSkeleton />;
  if (error)
    return (
      <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  if (!result) return null;

  const { totals, currency } = result;

  const chartData = result.series.map((p) => ({
    day: shortDayLabel(p.day),
    Vendido: p.soldValue,
    Cotizado: p.quotedValue,
  }));
  const hasSeries = result.series.some(
    (p) => p.soldValue > 0 || p.quotedValue > 0
  );

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          title="Ventas ganadas"
          value={totals.wonCount.toLocaleString("es-ES")}
          icon={Trophy}
          subtitle={`${totals.lostCount} perdidas`}
        />
        <MetricCard
          title="Monto vendido"
          value={formatCurrency(totals.wonValue, currency)}
          icon={DollarSign}
          subtitle="Ofertas ganadas del período"
        />
        <MetricCard
          title="Ticket promedio"
          value={
            totals.ticket == null ? "—" : formatCurrency(totals.ticket, currency)
          }
          icon={ShoppingCart}
          subtitle="Monto vendido / ventas"
        />
        <MetricCard
          title="Tasa de cierre"
          value={formatPercent(totals.winRate)}
          icon={Target}
          subtitle="Ganadas / decididas"
        />
        <MetricCard
          title="Cotizaciones"
          value={totals.quotedCount.toLocaleString("es-ES")}
          icon={FileText}
          subtitle={`${totals.openCount} abiertas`}
        />
        <MetricCard
          title="Monto cotizado"
          value={formatCurrency(totals.quotedValue, currency)}
          icon={Wallet}
          subtitle="Ofertas creadas del período"
        />
      </div>

      {/* Serie diaria */}
      <Panel
        title="Ventas y cotizaciones"
        subtitle="Monto por día (vendido y cotizado)"
      >
        {!hasSeries ? (
          <EmptyState
            icon={DollarSign}
            title="Sin movimientos"
            hint="No hay ofertas creadas ni ventas cerradas en el período."
          />
        ) : (
          <BarChart
            data={chartData}
            index="day"
            categories={["Vendido", "Cotizado"]}
            colors={["emerald", "blue"]}
            valueFormatter={(v) => formatCurrency(v, currency)}
            yAxisWidth={64}
            allowDecimals={false}
            className="h-[280px]"
          />
        )}
      </Panel>

      {/* Embudo por etapa */}
      <Panel
        title="Embudo por etapa"
        subtitle="Ofertas abiertas ahora, agrupadas por etapa"
      >
        {result.funnel.length === 0 ? (
          <EmptyState
            icon={Target}
            title="Sin ofertas abiertas"
            hint="Todas las ofertas del período están ganadas o perdidas."
          />
        ) : (
          <Funnel stages={result.funnel} currency={currency} />
        )}
      </Panel>

      {/* Tablas por agente / equipo / producto */}
      <Panel
        title="Rendimiento por agente"
        subtitle="Cotizaciones y ventas del período"
        bodyClassName="p-0"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportTable("ventas-agentes.csv", "Agente", result.agents)}
            disabled={result.agents.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        }
      >
        <SalesTable
          firstColumn="Agente"
          rows={result.agents}
          currency={currency}
          emptyLabel="Sin ofertas asignadas en el período."
        />
      </Panel>

      <Panel
        title="Rendimiento por equipo"
        subtitle="Cotizaciones y ventas del período"
        bodyClassName="p-0"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportTable("ventas-equipos.csv", "Equipo", result.teams)}
            disabled={result.teams.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        }
      >
        <SalesTable
          firstColumn="Equipo"
          rows={result.teams}
          currency={currency}
          emptyLabel="Sin equipos con ofertas en el período."
        />
      </Panel>

      <Panel
        title="Rendimiento por producto"
        subtitle="Cotizaciones y ventas por producto / servicio"
        bodyClassName="p-0"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportTable("ventas-productos.csv", "Producto", result.products)
            }
            disabled={result.products.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        }
      >
        <SalesTable
          firstColumn="Producto"
          rows={result.products}
          currency={currency}
          emptyLabel="Sin productos registrados en las ofertas del período."
        />
      </Panel>

      {/* Registro de ventas */}
      <Panel
        title="Registro de ventas"
        subtitle="Ofertas ganadas en el período"
        bodyClassName="p-0"
        actions={
          result.sales.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportToCsv(
                  "ventas-registro.csv",
                  [
                    "Fecha",
                    "Oferta",
                    "Contacto",
                    "Agente",
                    "Producto",
                    "Monto",
                    "Moneda",
                  ],
                  result.sales.map((s) => [
                    formatDateTime(s.date),
                    s.title,
                    s.contactName,
                    s.agentName,
                    s.product,
                    formatCurrency(s.value, s.currency ?? currency),
                    s.currency ?? currency,
                  ])
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Exportar CSV
            </Button>
          ) : undefined
        }
      >
        {result.sales.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Trophy}
              title="Sin ventas registradas"
              hint="Marca ofertas como ganadas para verlas aquí."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Fecha</th>
                  <th className="px-3 py-3 font-medium">Oferta</th>
                  <th className="px-3 py-3 font-medium">Contacto</th>
                  <th className="px-3 py-3 font-medium">Agente</th>
                  <th className="px-3 py-3 font-medium">Producto</th>
                  <th className="px-5 py-3 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                {result.sales.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-0 hover:bg-muted/40"
                  >
                    <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                      {formatDateTime(s.date)}
                    </td>
                    <td className="px-3 py-3 font-medium text-foreground">
                      {s.title}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {s.contactName || "—"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {s.agentName}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {s.product}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-foreground">
                      {formatCurrency(s.value, s.currency ?? currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function exportTable(
  filename: string,
  firstColumn: string,
  rows: SalesTableRow[]
) {
  exportToCsv(
    filename,
    [
      firstColumn,
      "Cotizadas",
      "Monto cotizado",
      "Ganadas",
      "Monto vendido",
      "Perdidas",
      "Tasa de cierre",
    ],
    rows.map((r) => [
      r.name,
      String(r.quotedCount),
      String(r.quotedValue),
      String(r.wonCount),
      String(r.wonValue),
      String(r.lostCount),
      formatPercent(r.winRate),
    ])
  );
}

function SalesTable({
  firstColumn,
  rows,
  currency,
  emptyLabel,
}: {
  firstColumn: string;
  rows: SalesTableRow[];
  currency: string;
  emptyLabel: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-5 py-3 font-medium">{firstColumn}</th>
            <th className="px-3 py-3 text-right font-medium">Cotizadas</th>
            <th className="px-3 py-3 text-right font-medium">Monto cotizado</th>
            <th className="px-3 py-3 text-right font-medium">Ganadas</th>
            <th className="px-3 py-3 text-right font-medium">Monto vendido</th>
            <th className="px-3 py-3 text-right font-medium">Perdidas</th>
            <th className="px-5 py-3 text-right font-medium">Tasa de cierre</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="px-5 py-10 text-center text-sm text-muted-foreground"
              >
                {emptyLabel}
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
                  {r.quotedCount.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {formatCurrency(r.quotedValue, currency)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-foreground">
                  {r.wonCount.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums font-medium text-foreground">
                  {formatCurrency(r.wonValue, currency)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.lostCount.toLocaleString("es-ES")}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                  {formatPercent(r.winRate)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Funnel({
  stages,
  currency,
}: {
  stages: SalesResult["funnel"];
  currency: string;
}) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  const total = stages.reduce((sum, s) => sum + s.count, 0);
  return (
    <div className="space-y-3">
      {stages.map((stage) => {
        const pct = Math.round((stage.value / max) * 100);
        return (
          <div key={stage.stageId}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium text-foreground">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: stage.color ?? "#3b82f6" }}
                />
                {stage.name}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {stage.count.toLocaleString("es-ES")}
                {total > 0 ? ` · ${Math.round((stage.count / total) * 100)}%` : ""}
                {" · "}
                {formatCurrency(stage.value, currency)}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(pct, stage.value > 0 ? 2 : 0)}%`,
                  backgroundColor: stage.color ?? "#3b82f6",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SalesSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[320px] rounded-xl" />
      <Skeleton className="h-[240px] rounded-xl" />
      <Skeleton className="h-[260px] rounded-xl" />
    </div>
  );
}
