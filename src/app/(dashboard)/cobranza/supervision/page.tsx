"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Handshake,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  Shuffle,
  Users,
} from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { Panel } from "@/components/metrics/panel";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_PER_AGENT,
  SUPERVISION_REFRESH_MS,
  agentStatusLabel,
  clampPerAgent,
  daysLeftLabel,
  filterPromisesByAgent,
  normalizeDays,
  summarizeBoard,
} from "@/lib/collections/supervision";
import {
  PROMISE_STATUS_TONE,
  formatDate,
  formatPercent,
  formatUsd,
} from "@/lib/collections/format";
import {
  COLLECTION_PROMISE_STATUSES,
  COLLECTION_SEGMENTS,
  labelFor,
  type CollectionPromiseStatus,
  type CollectionSupervisorPresence,
  type CollectionSupervisorPromise,
  type CollectionSupervisorRow,
  type CollectionSupervisorTotals,
} from "@/types/collections";
import { cn } from "@/lib/utils";

const selectClass =
  "h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const DAY_OPTIONS = [7, 14, 30];

const ROLE_LABEL: Record<string, string> = {
  agent: "Gestor",
  admin: "Supervisor",
  owner: "Dueño",
};

interface SupervisionPayload {
  board: CollectionSupervisorRow[];
  promises: CollectionSupervisorPromise[];
  totals: CollectionSupervisorTotals;
  presence: CollectionSupervisorPresence[];
  days: number;
  updated_at: string;
}

const EMPTY_TOTALS: CollectionSupervisorTotals = {
  portfolio_size: 0,
  portfolio_balance: 0,
  portfolio_overdue: 0,
  unassigned_count: 0,
  unassigned_balance: 0,
  assigned_count: 0,
  agents_total: 0,
  agents_with_portfolio: 0,
};

export default function SupervisionCobranzaPage() {
  const { accountRole } = useAuth();
  const canSupervise = accountRole === "admin" || accountRole === "owner";

  const [dayWindow, setDayWindow] = useState(7);
  const [board, setBoard] = useState<CollectionSupervisorRow[]>([]);
  const [promises, setPromises] = useState<CollectionSupervisorPromise[]>([]);
  const [totals, setTotals] = useState<CollectionSupervisorTotals>(EMPTY_TOTALS);
  const [presence, setPresence] = useState<CollectionSupervisorPresence[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [perAgent, setPerAgent] = useState(String(DEFAULT_PER_AGENT));
  const [segment, setSegment] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [distributing, setDistributing] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!canSupervise) {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);

      try {
        const response = await fetch(
          `/api/cobranza/supervision?days=${normalizeDays(dayWindow)}`
        );
        const json = (await response.json().catch(() => ({}))) as
          | SupervisionPayload
          | { error?: string };

        if (!response.ok || !("board" in json)) {
          const message =
            (json as { error?: string }).error ??
            "No se pudo cargar la supervisión.";
          setError(message);
          return;
        }

        setError(null);
        setBoard(json.board);
        setPromises(json.promises);
        setTotals(json.totals ?? EMPTY_TOTALS);
        setPresence(json.presence ?? []);
        setUpdatedAt(json.updated_at);
      } catch {
        setError("Sin conexión con el servidor.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [canSupervise, dayWindow]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!canSupervise) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, SUPERVISION_REFRESH_MS);
    return () => clearInterval(timer);
  }, [canSupervise, load]);

  const summary = useMemo(() => summarizeBoard(board), [board]);
  const presenceByUser = useMemo(
    () => new Map(presence.map((row) => [row.user_id, row])),
    [presence]
  );
  const visiblePromises = useMemo(
    () => filterPromisesByAgent(promises, selectedAgent),
    [promises, selectedAgent]
  );
  const selectedAgentName = useMemo(() => {
    if (!selectedAgent) return null;
    return board.find((row) => row.user_id === selectedAgent)?.name ?? "Gestor";
  }, [board, selectedAgent]);

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return null;
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("es-VE", {
      timeZone: "America/Caracas",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  }, [updatedAt]);

  async function handleDistribute() {
    setDistributing(true);
    try {
      const response = await fetch("/api/cobranza/distribute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          perAgent: clampPerAgent(perAgent),
          segment: segment || null,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        assigned?: number;
        agents?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(json.error ?? "No se pudo repartir la cartera.");
      }

      const assigned = Number(json.assigned) || 0;
      const agents = Number(json.agents) || 0;

      if (assigned === 0) {
        toast.info(
          "No había deudores sin asignar con ese filtro. Nada se movió."
        );
      } else {
        toast.success(
          `Se repartieron ${assigned} caso${assigned === 1 ? "" : "s"} entre ${agents} gestor${agents === 1 ? "" : "es"}.`
        );
      }

      setConfirmOpen(false);
      await load(true);
    } catch (distributeError) {
      toast.error(
        distributeError instanceof Error
          ? distributeError.message
          : "No se pudo repartir la cartera."
      );
    } finally {
      setDistributing(false);
    }
  }

  if (!canSupervise) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={ShieldAlert}
          title="Supervisión solo para administradores"
          hint="Pide a un admin o al dueño del negocio que te asigne ese rol para ver el tablero del equipo."
        />
        <div className="text-center">
          <Link
            href="/cobranza/consola"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Ir a mi consola
          </Link>
        </div>
      </div>
    );
  }

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Supervisión de cobranza
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Carga por gestor, promesas del día y reparto de la cartera sin
            asignar.
            {updatedLabel ? ` Actualizado ${updatedLabel}.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/cobranza/reportes"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Reportes
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Link>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Actualizar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={totals.unassigned_count === 0 || totals.agents_total === 0}
          >
            <Shuffle className="mr-2 h-4 w-4" />
            Repartir cartera
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p>{error}</p>
              <p className="mt-1 text-xs text-red-300/80">
                Si el mensaje menciona la migración 126, pide al responsable de
                la base que la aplique y vuelve a actualizar.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Gestiones de hoy"
          value={String(summary.actionsToday)}
          icon={PhoneCall}
          subtitle={`${summary.contactsToday} contactos · ${formatPercent(summary.contactRate)}`}
        />
        <MetricCard
          title="PTP de hoy"
          value={String(summary.ptpToday)}
          icon={Handshake}
          subtitle={`${summary.dueToday} promesas vencen hoy`}
        />
        <MetricCard
          title="Promesas vencidas"
          value={String(summary.overdue)}
          icon={AlertTriangle}
          subtitle={`${summary.broken30d} rotas en 30 días`}
        />
        <MetricCard
          title="Sin asignar"
          value={String(totals.unassigned_count)}
          icon={Users}
          subtitle={formatUsd(totals.unassigned_balance)}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel
          title="Equipo"
          subtitle="Haz clic en un gestor para ver solo sus promesas"
          actions={
            selectedAgent ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedAgent(null)}
              >
                Ver todo el equipo
              </Button>
            ) : null
          }
          bodyClassName="p-0"
        >
          {board.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Users}
                title="Sin equipo operativo"
                hint="Invita gestores con rol agente para ver su carga y repartir la cartera."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gestor</TableHead>
                    <TableHead className="text-right">Cartera</TableHead>
                    <TableHead className="text-right">Hoy</TableHead>
                    <TableHead className="hidden text-right md:table-cell">
                      Contacto
                    </TableHead>
                    <TableHead className="text-right">PTP hoy</TableHead>
                    <TableHead className="text-right">Vencen hoy</TableHead>
                    <TableHead className="text-right">Vencidas</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">
                      Rotas 30d
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {board.map((row) => {
                    const status = presenceByUser.get(row.user_id);
                    const active = row.user_id === selectedAgent;
                    return (
                      <TableRow
                        key={row.user_id}
                        className={cn(
                          "cursor-pointer",
                          active && "bg-muted/60"
                        )}
                        onClick={() =>
                          setSelectedAgent(active ? null : row.user_id)
                        }
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <PresenceDot
                              presence={status}
                              agentStatus={status?.agent_status}
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {row.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {ROLE_LABEL[row.role] ?? row.role}
                                {status
                                  ? ` · ${agentStatusLabel(status.agent_status)}`
                                  : ""}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="font-medium text-foreground">
                            {row.assigned_count}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {formatUsd(row.balance_assigned)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.actions_today}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {row.actions_today > 0
                            ? formatPercent(
                                (row.contacts_today / row.actions_today) * 100
                              )
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.ptp_today}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.promises_due_today}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            row.promises_overdue > 0 && "font-medium text-red-300"
                          )}
                        >
                          {row.promises_overdue}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums lg:table-cell">
                          {row.broken_promises_30d}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>

        <Panel title="Reparto de cartera" subtitle="Solo deudores sin asignar">
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">Pendientes</span>
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {totals.unassigned_count}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatUsd(totals.unassigned_balance)}{" "}
                por repartir de {formatUsd(totals.portfolio_balance)} en cartera.
              </p>
            </div>

            <div className="space-y-2">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="distribute-segment"
              >
                Segmento
              </label>
              <select
                id="distribute-segment"
                className={cn(selectClass, "w-full")}
                value={segment}
                onChange={(event) => setSegment(event.target.value)}
              >
                <option value="">Todos los segmentos</option>
                {COLLECTION_SEGMENTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="distribute-per-agent"
              >
                Casos por gestor
              </label>
              <input
                id="distribute-per-agent"
                type="number"
                min={1}
                max={50}
                value={perAgent}
                onChange={(event) => setPerAgent(event.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {totals.agents_total} gestor
                {totals.agents_total === 1 ? "" : "es"} con rol agente
              </span>
              <span>
                {totals.agents_with_portfolio} con cartera
              </span>
            </div>

            <Button
              type="button"
              className="w-full"
              onClick={() => setConfirmOpen(true)}
              disabled={
                distributing ||
                totals.unassigned_count === 0 ||
                totals.agents_total === 0
              }
            >
              <Shuffle className="mr-2 h-4 w-4" />
              Repartir ahora
            </Button>

            {totals.agents_total === 0 ? (
              <p className="text-xs text-amber-300">
                No hay gestores con rol agente. Cambia el rol de un miembro en
                Configuración → Usuarios para poder repartir.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Se entregan hasta {clampPerAgent(perAgent)} casos a cada gestor,
                empezando por el que menos cartera tiene. Nunca se mueve un
                deudor ya asignado.
              </p>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        title="Promesas por vencer"
        subtitle={
          selectedAgentName
            ? `Solo ${selectedAgentName} · próximos ${normalizeDays(dayWindow)} días`
            : `Próximos ${normalizeDays(dayWindow)} días, incluidas las vencidas`
        }
        actions={
          <div className="flex items-center gap-2">
            {selectedAgent ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedAgent(null)}
              >
                Quitar filtro
              </Button>
            ) : null}
            <select
              className={selectClass}
              value={dayWindow}
              onChange={(event) => setDayWindow(Number(event.target.value))}
              aria-label="Ventana de promesas"
            >
              {DAY_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days} días
                </option>
              ))}
            </select>
          </div>
        }
        bodyClassName="p-0"
      >
        {visiblePromises.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={CalendarClock}
              title="Sin promesas en esta ventana"
              hint="Cuando los gestores registren PTP, aparecerán aquí con su fecha y su dueño."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deudor</TableHead>
                  <TableHead>Gestor</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Crédito</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePromises.map((promise) => (
                  <TableRow key={promise.promise_id}>
                    <TableCell>
                      <Link
                        href={`/cobranza/cartera/${promise.debtor_id}`}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {promise.debtor_name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {promise.document_number ?? "Sin documento"}
                        {promise.phone_primary ? ` · ${promise.phone_primary}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {promise.agent_name ?? "Sin asignar"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(promise.amount)}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-foreground">
                        {formatDate(promise.due_date)}
                      </span>
                      <span
                        className={cn(
                          "block text-xs",
                          promise.days_left < 0
                            ? "text-red-300"
                            : promise.days_left === 0
                              ? "text-amber-300"
                              : "text-muted-foreground"
                        )}
                      >
                        {daysLeftLabel(promise.days_left)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                          PROMISE_STATUS_TONE[
                            promise.status as CollectionPromiseStatus
                          ]
                        )}
                      >
                        {labelFor(COLLECTION_PROMISE_STATUSES, promise.status)}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {promise.credit_folio ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Repartir cartera sin asignar</DialogTitle>
            <DialogDescription>
              Se asignarán hasta {clampPerAgent(perAgent)} casos a cada uno de
              los {totals.agents_total} gestores con rol agente
              {segment
                ? `, solo del segmento ${labelFor(COLLECTION_SEGMENTS, segment).toLowerCase()}`
                : ""}
              . Los deudores ya asignados no se tocan.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Disponibles</span>
              <span className="font-medium tabular-nums">
                {totals.unassigned_count} casos
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Saldo</span>
              <span className="font-medium tabular-nums">
                {formatUsd(totals.unassigned_balance)}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={distributing}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleDistribute()}
              disabled={distributing}
            >
              {distributing ? "Repartiendo…" : "Repartir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PresenceDot({
  presence,
  agentStatus,
}: {
  presence?: CollectionSupervisorPresence;
  agentStatus?: string | null;
}) {
  const tone = !presence
    ? "bg-slate-500"
    : presence.status === "away"
      ? "bg-amber-400"
      : agentStatus === "available"
        ? "bg-emerald-500"
        : agentStatus === "busy"
          ? "bg-sky-400"
          : agentStatus === "break"
            ? "bg-amber-400"
            : agentStatus === "wrap_up"
              ? "bg-violet-400"
              : "bg-slate-500";

  return (
    <span
      className={cn("h-2 w-2 shrink-0 rounded-full", tone)}
      title={presence ? agentStatusLabel(agentStatus) : "Sin señal"}
    />
  );
}
