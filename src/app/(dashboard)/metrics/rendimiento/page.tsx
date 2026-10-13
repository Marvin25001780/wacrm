"use client";

// ============================================================
// Métricas · Rendimiento.
//
//   • KPIs (1ª respuesta, tiempo de respuesta, tiempo de cierre, CSAT)
//   • barras de tiempos por día
//   • satisfacción del cliente (CSAT) con dona y desglose
//   • rendimiento por AGENTE y por EQUIPO (con exportación CSV)
//   • registros de estado de los agentes
//
// La agregación es pura (`@/lib/metrics/performance`) y se calcula en
// el cliente sobre las filas del período; RLS acota todo a la cuenta
// y los filtros se aplican antes de agregar.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { Clock, Download, Gauge, Reply, Smile, Timer } from "lucide-react";
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
import { exportToCsv } from "@/lib/export/csv";
import { formatMinutes, formatScore } from "@/lib/metrics/format";
import {
  aggregatePerformance,
  type CsatRow,
  type PerformanceResult,
  type PerfConversationRow,
  type PerfMessageRow,
  type PerfTeamMemberRow,
  type StatusEventRow,
} from "@/lib/metrics/performance";

const CONVERSATION_SELECT = "id, assigned_agent_id, channel, created_at, closed_at";

const STATUS_LABEL: Record<string, string> = {
  online: "En línea",
  away: "Ausente",
  busy: "Ocupado",
  break: "Descanso",
  offline: "Desconectado",
};

const STATUS_DOT: Record<string, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  busy: "bg-red-500",
  break: "bg-violet-500",
  offline: "bg-muted-foreground",
};

const CSAT_COLORS = {
  satisfied: "#22c55e",
  neutral: "#f59e0b",
  unsatisfied: "#ef4444",
};

function normalizeChannel(channel: string | null | undefined): string {
  const value = (channel ?? "").trim();
  return value || "whatsapp";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PerformanceMetricsPage() {
  const supabase = createClient();
  const { accountId, profileLoading } = useAuth();
  const { applied, range, agents, teams } = useMetricsFilters();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PerformanceResult | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const { fromIso, toIsoExclusive } = rangeToIso(range);

      const [msgRes, convActRes, convNewRes, csatRes, eventsRes, membersRes] =
        await Promise.all([
          supabase
            .from("messages")
            .select("conversation_id, sender_type, sender_id, created_at")
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
            .from("csat_responses")
            .select("conversation_id, agent_id, score, comment, created_at")
            .gte("created_at", fromIso)
            .lt("created_at", toIsoExclusive)
            .limit(20000),
          supabase
            .from("agent_status_events")
            .select("user_id, status, created_at")
            .gte("created_at", fromIso)
            .lt("created_at", toIsoExclusive)
            .limit(20000),
          supabase
            .from("team_members")
            .select("team_id, profile_id")
            .eq("account_id", accountId)
            .limit(20000),
        ]);

      if (msgRes.error) throw new Error(msgRes.error.message);

      // Une conversaciones activas + nuevas (sin duplicados).
      const convMap = new Map<string, PerfConversationRow>();
      for (const c of [
        ...((convActRes.data ?? []) as unknown as PerfConversationRow[]),
        ...((convNewRes.data ?? []) as unknown as PerfConversationRow[]),
      ]) {
        convMap.set(c.id, c);
      }
      let conversations = [...convMap.values()];
      let messages = (msgRes.data ?? []) as unknown as PerfMessageRow[];
      const csatRows = csatRes.error
        ? []
        : ((csatRes.data ?? []) as unknown as CsatRow[]);
      const events = eventsRes.error
        ? []
        : ((eventsRes.data ?? []) as unknown as StatusEventRow[]);
      const members: PerfTeamMemberRow[] = membersRes.error
        ? []
        : ((membersRes.data ?? []) as Array<{
            team_id: string;
            profile_id: string;
          }>).map((m) => ({ teamId: m.team_id, profileId: m.profile_id }));

      // ---- Filtros (agente / equipo / canal) -------------------
      if (applied.agentId !== "all") {
        const agent = agents.find((a) => a.id === applied.agentId);
        const ids = new Set<string>([applied.agentId]);
        if (agent?.userId) ids.add(agent.userId);
        conversations = conversations.filter(
          (c) => c.assigned_agent_id && ids.has(c.assigned_agent_id)
        );
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
        conversations = conversations.filter(
          (c) =>
            c.assigned_agent_id &&
            (memberIds.has(c.assigned_agent_id) ||
              memberUserIds.has(c.assigned_agent_id))
        );
      }
      if (applied.channel !== "all") {
        conversations = conversations.filter(
          (c) => normalizeChannel(c.channel) === applied.channel
        );
      }

      const hasConvFilter =
        applied.agentId !== "all" ||
        applied.teamId !== "all" ||
        applied.channel !== "all";
      if (hasConvFilter) {
        const allowed = new Set(conversations.map((c) => c.id));
        messages = messages.filter((m) => allowed.has(m.conversation_id));
      }

      // ---- Registros de estado: acota a agentes/equipos -------
      const agentIds =
        applied.agentId === "all"
          ? null
          : new Set(
              [applied.agentId, agents.find((a) => a.id === applied.agentId)?.userId].filter(
                Boolean
              ) as string[]
            );
      const teamProfileIds =
        applied.teamId === "all"
          ? null
          : new Set(
              members
                .filter((m) => m.teamId === applied.teamId)
                .map((m) => m.profileId)
            );
      const teamUserIds =
        applied.teamId === "all"
          ? null
          : new Set(
              agents
                .filter((a) => teamProfileIds?.has(a.id))
                .map((a) => a.userId ?? a.id)
            );

      const filteredEvents = events.filter((e) => {
        if (agentIds && !agentIds.has(e.user_id)) return false;
        if (teamUserIds && !teamUserIds.has(e.user_id)) return false;
        return true;
      });

      const teamOptions = teams.map((t) => ({ id: t.id, name: t.name }));
      const profileOptions = agents.map((a) => ({
        id: a.id,
        userId: a.userId,
        name: a.name,
      }));

      setResult(
        aggregatePerformance(
          conversations,
          messages,
          profileOptions,
          teamOptions,
          members,
          csatRows,
          filteredEvents,
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

  const timesChart = (result?.series ?? []).map((p) => ({
    day: shortDayLabel(p.day),
    "1ª respuesta": p.firstResponse,
    Respuesta: p.response,
    Cierre: p.close,
  }));

  const hasTimes = (result?.totals.respondedConversations ?? 0) > 0;

  function exportGeneric(filename: string, rows: TableRow[]) {
    exportToCsv(
      filename,
      [
        "Nombre",
        "Conversaciones",
        "Nuevas",
        "Mensajes enviados",
        "1ª respuesta",
        "Tiempo de cierre",
        "CSAT",
        "Respuestas CSAT",
      ],
      rows.map((r) => [
        r.name,
        String(r.conversations),
        String(r.created),
        String(r.messagesSent),
        formatMinutes(r.firstResponseMin),
        formatMinutes(r.closeMin),
        formatScore(r.csatAvg),
        String(r.csatCount),
      ])
    );
  }

  function exportStatusEvents() {
    if (!result) return;
    exportToCsv(
      "rendimiento-estados.csv",
      ["Agente", "Estado", "Inicio", "Duración"],
      result.statusEvents.map((e) => [
        e.name,
        STATUS_LABEL[e.status] ?? e.status,
        formatDateTime(e.startedAt),
        formatMinutes(e.durationMin),
      ])
    );
  }

  return (
    <div className="space-y-5">
      {loading ? (
        <PerformanceSkeleton />
      ) : error ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : !result ? null : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              title="1ª respuesta"
              value={formatMinutes(result.totals.firstResponseMin)}
              icon={Reply}
              subtitle={`${result.totals.respondedConversations} conversaciones`}
            />
            <MetricCard
              title="Tiempo de respuesta"
              value={formatMinutes(result.totals.responseMin)}
              icon={Clock}
              subtitle="Media de contestaciones"
            />
            <MetricCard
              title="Tiempo de cierre"
              value={formatMinutes(result.totals.closeMin)}
              icon={Timer}
              subtitle={`${result.totals.closedConversations} cerradas`}
            />
            <MetricCard
              title="CSAT"
              value={formatScore(result.totals.csatAvg)}
              icon={Smile}
              subtitle={`${result.totals.csatCount} respuestas`}
            />
          </div>

          {/* Tiempos por día */}
          <Panel
            title="Tiempos de respuesta"
            subtitle="Promedio diario en minutos (1ª respuesta, respuesta y cierre)"
          >
            {!hasTimes ? (
              <EmptyState
                icon={Clock}
                title="Sin datos de tiempos"
                hint="Aún no hay conversaciones con respuesta en el período."
              />
            ) : (
              <BarChart
                data={timesChart}
                index="day"
                categories={["1ª respuesta", "Respuesta", "Cierre"]}
                colors={["emerald", "blue", "amber"]}
                valueFormatter={(v) => `${v.toLocaleString("es-ES")} min`}
                yAxisWidth={48}
                allowDecimals={false}
                className="h-[280px]"
              />
            )}
          </Panel>

          {/* CSAT + registros de estado */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel
              title="Satisfacción del cliente (CSAT)"
              subtitle="Distribución de las respuestas del período"
            >
              {result.totals.csatCount === 0 ? (
                <EmptyState
                  icon={Smile}
                  title="Sin respuestas CSAT"
                  hint="Registra encuestas de satisfacción para verlas aquí."
                />
              ) : (
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                  <Donut
                    centerLabel={formatScore(result.totals.csatAvg)}
                    centerSub="CSAT"
                    slices={[
                      {
                        label: "Satisfechos",
                        value: result.csat.satisfied,
                        color: CSAT_COLORS.satisfied,
                      },
                      {
                        label: "Neutrales",
                        value: result.csat.neutral,
                        color: CSAT_COLORS.neutral,
                      },
                      {
                        label: "Insatisfechos",
                        value: result.csat.unsatisfied,
                        color: CSAT_COLORS.unsatisfied,
                      },
                    ]}
                  />
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-lg font-bold tabular-nums text-emerald-400">
                        {result.csat.satisfied}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Satisfechos
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-lg font-bold tabular-nums text-amber-400">
                        {result.csat.neutral}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Neutrales
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-lg font-bold tabular-nums text-red-400">
                        {result.csat.unsatisfied}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Insatisfechos
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </Panel>

            <Panel
              title="Registros de estado"
              subtitle="Cambios de estado de los agentes en el período"
              actions={
                result.statusEvents.length > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportStatusEvents}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Exportar CSV
                  </Button>
                ) : undefined
              }
            >
              {result.statusEvents.length === 0 ? (
                <EmptyState
                  icon={Gauge}
                  title="Sin registros de estado"
                  hint="El estado de los agentes se registra automáticamente con la presencia."
                />
              ) : (
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Agente</th>
                        <th className="py-2 pr-3 font-medium">Estado</th>
                        <th className="py-2 pr-3 font-medium">Desde</th>
                        <th className="py-2 font-medium">Duración</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.statusEvents.slice(0, 100).map((e, i) => (
                        <tr
                          key={`${e.userId}-${e.startedAt}-${i}`}
                          className="border-b border-border last:border-0"
                        >
                          <td className="py-2 pr-3 text-foreground">{e.name}</td>
                          <td className="py-2 pr-3">
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  STATUS_DOT[e.status] ?? "bg-muted-foreground"
                                }`}
                              />
                              {STATUS_LABEL[e.status] ?? e.status}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {formatDateTime(e.startedAt)}
                          </td>
                          <td className="py-2 tabular-nums text-muted-foreground">
                            {formatMinutes(e.durationMin)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          {/* Tabla por agente */}
          <Panel
            title="Rendimiento por agente"
            subtitle="Actividad y tiempos del período"
            bodyClassName="p-0"
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => result && exportGeneric("rendimiento-agentes.csv", result.agents)}
                disabled={result.agents.length === 0}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Exportar CSV
              </Button>
            }
          >
            <PerformanceTable
              firstColumn="Agente"
              rows={result.agents}
              emptyLabel="Sin actividad de agentes en el período."
            />
          </Panel>

          {/* Tabla por equipo */}
          <Panel
            title="Rendimiento por equipo"
            subtitle="Actividad y tiempos del período"
            bodyClassName="p-0"
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => result && exportGeneric("rendimiento-equipos.csv", result.teams)}
                disabled={result.teams.length === 0}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Exportar CSV
              </Button>
            }
          >
            {result.teams.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={Gauge}
                  title="Sin equipos"
                  hint="Crea equipos y asigna agentes para ver su rendimiento."
                />
              </div>
            ) : (
              <PerformanceTable firstColumn="Equipo" rows={result.teams} />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

type TableRow = {
  name: string;
  conversations: number;
  created: number;
  messagesSent: number;
  firstResponseMin: number | null;
  closeMin: number | null;
  csatAvg: number | null;
  csatCount: number;
};

function PerformanceTable({
  firstColumn,
  rows,
  emptyLabel,
}: {
  firstColumn: string;
  rows: TableRow[];
  emptyLabel?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-5 py-3 font-medium">{firstColumn}</th>
            <th className="px-3 py-3 text-right font-medium">Conversaciones</th>
            <th className="px-3 py-3 text-right font-medium">Nuevas</th>
            <th className="px-3 py-3 text-right font-medium">
              Mensajes enviados
            </th>
            <th className="px-3 py-3 text-right font-medium">1ª respuesta</th>
            <th className="px-3 py-3 text-right font-medium">Cierre</th>
            <th className="px-5 py-3 text-right font-medium">CSAT</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="px-5 py-10 text-center text-sm text-muted-foreground"
              >
                {emptyLabel ?? "Sin datos en el período."}
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
                  {r.conversations.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.created.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.messagesSent.toLocaleString("es-ES")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-foreground">
                  {formatMinutes(r.firstResponseMin)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-foreground">
                  {formatMinutes(r.closeMin)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {formatScore(r.csatAvg)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function PerformanceSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[320px] w-full rounded-xl" />
      <Skeleton className="h-[320px] w-full rounded-xl" />
    </div>
  );
}
