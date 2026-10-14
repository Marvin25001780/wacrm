"use client";

// ============================================================
// Métricas · Llamadas
//
// KPIs de volumen, duración y resultado, serie diaria, mapa de calor
// de horas pico, tablas por agente y equipo, y registro de llamadas.
// Cada tabla exporta a CSV.
//
// Fuente: actividades con type = 'call' (tabla `activities`,
// migration 033 + campos de llamada de la migration 054). La fecha de
// la llamada es `due_at` (programada) o `created_at`.
//
// Se traen las llamadas del período y se agregan en una función pura
// (`aggregateCalls`). Los filtros de agente/equipo se aplican antes.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Download,
  Phone,
  PhoneCall,
  PhoneMissed,
  Timer,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { Panel } from "@/components/metrics/panel";
import { Donut } from "@/components/metrics/donut";
import { Heatmap } from "@/components/metrics/heatmap";
import { BarChart } from "@/components/tremor/bar-chart";
import { Button } from "@/components/ui/button";
import { useMetricsFilters } from "@/components/metrics/metrics-filter-context";
import { ActivityForm } from "@/components/activities/activity-form";
import {
  dayKeysInRange,
  rangeToIso,
  shortDayLabel,
} from "@/lib/metrics/period";
import { formatMinutes, formatPercent } from "@/lib/metrics/format";
import { exportToCsv } from "@/lib/export/csv";
import {
  activityStatusLabel,
  callDirectionLabel,
  callResultLabel,
} from "@/types";
import {
  aggregateCalls,
  type CallContactRow,
  type CallLogEntry,
  type CallProfileRow,
  type CallRow,
  type CallsResult,
  type CallTableRow,
  type CallTeamMemberRow,
  type CallTeamRow,
} from "@/lib/metrics/calls";

const CALL_SELECT =
  "id, subject, assigned_to, duration_minutes, status, outcome, call_direction, call_result, due_at, completed_at, contact_id, created_at";

const RESULT_COLORS = {
  answered: "#22c55e",
  noAnswer: "#f59e0b",
  busy: "#3b82f6",
  failed: "#ef4444",
  voicemail: "#a855f7",
  unknown: "#94a3b8",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  done: "Completada",
  cancelled: "Cancelada",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LlamadasMetricsPage() {
  const supabase = createClient();
  const { accountId, profileLoading } = useAuth();
  const { applied, range, agents, teams } = useMetricsFilters();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CallsResult | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const { fromIso, toIsoExclusive } = rangeToIso(range);

      const [dueRes, noDueRes, memberRes, contactRes] = await Promise.all([
        supabase
          .from("activities")
          .select(CALL_SELECT)
          .eq("type", "call")
          .gte("due_at", fromIso)
          .lt("due_at", toIsoExclusive)
          .limit(20000),
        supabase
          .from("activities")
          .select(CALL_SELECT)
          .eq("type", "call")
          .is("due_at", null)
          .gte("created_at", fromIso)
          .lt("created_at", toIsoExclusive)
          .limit(20000),
        supabase
          .from("team_members")
          .select("team_id, profile_id")
          .eq("account_id", accountId)
          .limit(20000),
        supabase.from("contacts").select("id, name").limit(20000),
      ]);

      const firstError = dueRes.error ?? noDueRes.error;
      if (firstError) throw new Error(firstError.message);

      // Une llamadas con fecha programada + las registradas sin fecha.
      const callMap = new Map<string, CallRow>();
      for (const c of [
        ...((dueRes.data ?? []) as unknown as CallRow[]),
        ...((noDueRes.data ?? []) as unknown as CallRow[]),
      ]) {
        callMap.set(c.id, c);
      }
      let calls = [...callMap.values()];

      const members: CallTeamMemberRow[] = memberRes.error
        ? []
        : ((memberRes.data ?? []) as Array<{
            team_id: string;
            profile_id: string;
          }>).map((m) => ({ teamId: m.team_id, profileId: m.profile_id }));
      const contacts: CallContactRow[] = contactRes.error
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
        calls = calls.filter((c) => c.assigned_to && ids.has(c.assigned_to));
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
        calls = calls.filter(
          (c) =>
            c.assigned_to &&
            (memberIds.has(c.assigned_to) || memberUserIds.has(c.assigned_to))
        );
      }

      const profileOptions: CallProfileRow[] = agents.map((a) => ({
        id: a.id,
        userId: a.userId,
        name: a.name,
      }));
      const teamOptions: CallTeamRow[] = teams.map((t) => ({
        id: t.id,
        name: t.name,
      }));

      setResult(
        aggregateCalls(
          calls,
          profileOptions,
          teamOptions,
          members,
          contacts,
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
  }, [accountId, applied, range, agents, teams, supabase]);

  useEffect(() => {
    if (profileLoading || !accountId) return;
    load();
  }, [accountId, profileLoading, load]);

  if (loading) return <CallsSkeleton />;
  if (error)
    return (
      <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  if (!result) return null;

  const { totals, results } = result;

  const chartData = result.series.map((p) => ({
    day: shortDayLabel(p.day),
    Total: p.total,
    Completadas: p.completed,
    Entrantes: p.inbound,
    Salientes: p.outbound,
  }));
  const hasSeries = result.series.some((p) => p.total > 0);
  const hasHeatmap = totals.total > 0;

  const resultSlices = [
    { label: "Contestadas", value: results.answered, color: RESULT_COLORS.answered },
    { label: "No contestadas", value: results.noAnswer, color: RESULT_COLORS.noAnswer },
    { label: "Ocupado", value: results.busy, color: RESULT_COLORS.busy },
    { label: "Fallidas", value: results.failed, color: RESULT_COLORS.failed },
    { label: "Buzón de voz", value: results.voicemail, color: RESULT_COLORS.voicemail },
    { label: "Sin especificar", value: results.unknown, color: RESULT_COLORS.unknown },
  ];

  return (
    <div className="space-y-5">
      {/* Acción rápida */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Phone className="mr-1.5 h-3.5 w-3.5" />
          Registrar llamada
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          title="Llamadas"
          value={totals.total.toLocaleString("es-ES")}
          icon={Phone}
          subtitle={`${totals.inbound} entrantes · ${totals.outbound} salientes`}
        />
        <MetricCard
          title="Completadas"
          value={totals.completed.toLocaleString("es-ES")}
          icon={CheckCircle2}
          subtitle={`${totals.pending} pendientes`}
        />
        <MetricCard
          title="Duración media"
          value={formatMinutes(totals.avgDurationMin)}
          icon={Clock}
          subtitle="Por llamada con duración"
        />
        <MetricCard
          title="Tasa de respuesta"
          value={formatPercent(totals.answerRate)}
          icon={PhoneCall}
          subtitle={`${totals.answered} contestadas`}
        />
        <MetricCard
          title="No efectivas"
          value={totals.missed.toLocaleString("es-ES")}
          icon={PhoneMissed}
          subtitle="No contestada / ocupado / fallida"
        />
        <MetricCard
          title="Tasa de cierre"
          value={formatPercent(totals.completionRate)}
          icon={Timer}
          subtitle={`${totals.cancelled} canceladas`}
        />
      </div>

      {/* Serie diaria */}
      <Panel
        title="Llamadas en el tiempo"
        subtitle="Volumen por día (total, completadas y por dirección)"
      >
        {!hasSeries ? (
          <EmptyState
            icon={Phone}
            title="Sin llamadas"
            hint="No hay llamadas registradas en el período."
          />
        ) : (
          <BarChart
            data={chartData}
            index="day"
            categories={["Total", "Completadas", "Entrantes", "Salientes"]}
            colors={["blue", "emerald", "violet", "amber"]}
            valueFormatter={(v) => v.toLocaleString("es-ES")}
            yAxisWidth={48}
            allowDecimals={false}
            className="h-[280px]"
          />
        )}
      </Panel>

      {/* Resultado + horas pico */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel
          title="Resultado de las llamadas"
          subtitle="Desenlace registrado en el período"
        >
          {totals.total === 0 ? (
            <EmptyState
              icon={PhoneCall}
              title="Sin llamadas"
              hint="Registra llamadas para ver su resultado."
            />
          ) : (
            <Donut
              centerLabel={totals.total.toLocaleString("es-ES")}
              centerSub="Llamadas"
              slices={resultSlices}
            />
          )}
        </Panel>

        <Panel
          title="Horas pico"
          subtitle="Llamadas por día de la semana y hora"
        >
          {!hasHeatmap ? (
            <EmptyState
              icon={Clock}
              title="Sin llamadas"
              hint="El mapa de calor aparece cuando hay llamadas en el período."
            />
          ) : (
            <Heatmap matrix={result.heatmap} rgb={[59, 130, 246]} />
          )}
        </Panel>
      </div>

      {/* Tablas por agente / equipo */}
      <Panel
        title="Rendimiento por agente"
        subtitle="Volumen y resultado del período"
        bodyClassName="p-0"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportTable("llamadas-agentes.csv", "Agente", result.agents)
            }
            disabled={result.agents.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        }
      >
        <CallsTable
          firstColumn="Agente"
          rows={result.agents}
          emptyLabel="Sin llamadas asignadas en el período."
        />
      </Panel>

      <Panel
        title="Rendimiento por equipo"
        subtitle="Volumen y resultado del período"
        bodyClassName="p-0"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportTable("llamadas-equipos.csv", "Equipo", result.teams)
            }
            disabled={result.teams.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        }
      >
        <CallsTable
          firstColumn="Equipo"
          rows={result.teams}
          emptyLabel="Sin equipos con llamadas en el período."
        />
      </Panel>

      {/* Registro de llamadas */}
      <Panel
        title="Registro de llamadas"
        subtitle="Llamadas del período (más recientes primero)"
        bodyClassName="p-0"
        actions={
          result.log.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportLog(result.log)}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Exportar CSV
            </Button>
          ) : undefined
        }
      >
        {result.log.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Phone}
              title="Sin llamadas registradas"
              hint="Usa «Registrar llamada» o créalas desde Actividades con tipo Llamada."
            />
          </div>
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Fecha</th>
                  <th className="px-3 py-3 font-medium">Asunto</th>
                  <th className="px-3 py-3 font-medium">Contacto</th>
                  <th className="px-3 py-3 font-medium">Agente</th>
                  <th className="px-3 py-3 font-medium">Dirección</th>
                  <th className="px-3 py-3 font-medium">Resultado</th>
                  <th className="px-3 py-3 text-right font-medium">Duración</th>
                  <th className="px-5 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {result.log.slice(0, 300).map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 hover:bg-muted/40"
                  >
                    <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                      {formatDateTime(c.at)}
                    </td>
                    <td className="px-3 py-3 font-medium text-foreground">
                      {c.subject}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {c.contactName || "—"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {c.agentName}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {c.direction ? callDirectionLabel(c.direction) : "—"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {c.result ? callResultLabel(c.result) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {formatMinutes(c.durationMin)}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {STATUS_LABEL[c.status] ?? activityStatusLabel(c.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <ActivityForm
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultType="call"
        onSaved={load}
      />
    </div>
  );
}

function exportTable(
  filename: string,
  firstColumn: string,
  rows: CallTableRow[]
) {
  exportToCsv(
    filename,
    [
      firstColumn,
      "Total",
      "Completadas",
      "Pendientes",
      "Canceladas",
      "Entrantes",
      "Salientes",
      "Contestadas",
      "No efectivas",
      "Duración media",
      "Tasa de cierre",
    ],
    rows.map((r) => [
      r.name,
      String(r.total),
      String(r.completed),
      String(r.pending),
      String(r.cancelled),
      String(r.inbound),
      String(r.outbound),
      String(r.answered),
      String(r.missed),
      formatMinutes(r.avgDurationMin),
      formatPercent(r.completionRate),
    ])
  );
}

function exportLog(rows: CallLogEntry[]) {
  exportToCsv(
    "llamadas-registro.csv",
    [
      "Fecha",
      "Asunto",
      "Contacto",
      "Agente",
      "Dirección",
      "Resultado",
      "Duración",
      "Estado",
    ],
    rows.map((c) => [
      formatDateTime(c.at),
      c.subject,
      c.contactName,
      c.agentName,
      c.direction ? callDirectionLabel(c.direction) : "",
      c.result ? callResultLabel(c.result) : "",
      formatMinutes(c.durationMin),
      STATUS_LABEL[c.status] ?? c.status,
    ])
  );
}

function CallsTable({
  firstColumn,
  rows,
  emptyLabel,
}: {
  firstColumn: string;
  rows: CallTableRow[];
  emptyLabel: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-5 py-3 font-medium">{firstColumn}</th>
            <th className="px-3 py-3 text-right font-medium">Total</th>
            <th className="px-3 py-3 text-right font-medium">Completadas</th>
            <th className="px-3 py-3 text-right font-medium">Entrantes</th>
            <th className="px-3 py-3 text-right font-medium">Salientes</th>
            <th className="px-3 py-3 text-right font-medium">Contestadas</th>
            <th className="px-3 py-3 text-right font-medium">No efectivas</th>
            <th className="px-3 py-3 text-right font-medium">Duración media</th>
            <th className="px-5 py-3 text-right font-medium">Tasa de cierre</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={9}
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
                <td className="px-3 py-3 text-right tabular-nums font-medium text-foreground">
                  {r.total.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.completed.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.inbound.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.outbound.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.answered.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.missed.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {formatMinutes(r.avgDurationMin)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
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

function CallsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[320px] rounded-xl" />
      <Skeleton className="h-[260px] rounded-xl" />
      <Skeleton className="h-[260px] rounded-xl" />
    </div>
  );
}
