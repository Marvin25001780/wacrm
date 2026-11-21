"use client";

// ============================================================
// Consola del agente de cobranza (migración 125).
//
// Tres columnas, como la mesa de trabajo de un call center:
//   izquierda  cola ordenada por riesgo (RPC collection_agent_queue)
//   centro     ficha del deudor, créditos, cuotas y PTP
//   derecha    llamada + registro de la gestión
//
// La cola la calcula el servidor; aquí no se reordena nada. Tomar un
// deudor es una acción explícita (nunca implícita al abrir la ficha):
// así dos agentes no se pisan y el admin ve quién tiene qué.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Gauge,
  Handshake,
  Loader2,
  MessageCircle,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  UserCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Panel } from "@/components/metrics/panel";
import { ActionForm } from "@/components/collections/action-form";
import { PaymentDialog } from "@/components/collections/payment-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTelephony } from "@/components/telephony/telephony-provider";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  QUEUE_RANKS,
  QUEUE_SCOPES,
  SEGMENT_LABELS,
  dueLabel,
  normalizeQueueSearch,
  queueRankLabel,
  queueRankTone,
  type QueueScope,
} from "@/lib/collections/desk";
import {
  DEBTOR_STATUS_TONE,
  INSTALLMENT_STATUS_TONE,
  PROMISE_STATUS_TONE,
  SEGMENT_TONE,
  daysOverdue,
  formatDate,
  formatUsd,
  installmentBalance,
  isInstallmentOverdue,
  todayIso,
} from "@/lib/collections/format";
import {
  COLLECTION_DEBTOR_STATUSES,
  COLLECTION_INSTALLMENT_STATUSES,
  COLLECTION_PROMISE_STATUSES,
  COLLECTION_SEGMENTS,
  labelFor,
  type CollectionAction,
  type CollectionCredit,
  type CollectionDebtorStatus,
  type CollectionInstallment,
  type CollectionOutcome,
  type CollectionPromise,
  type CollectionQueueRow,
  type CollectionSegment,
} from "@/types/collections";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 30;

interface Detail {
  credits: CollectionCredit[];
  installments: CollectionInstallment[];
  promises: CollectionPromise[];
  actions: CollectionAction[];
}

const EMPTY_DETAIL: Detail = {
  credits: [],
  installments: [],
  promises: [],
  actions: [],
};

interface LinkedCall {
  id: string;
  seconds?: number | null;
}

export default function ConsolaCobranzaPage() {
  const supabase = createClient();
  const { user, accountId, accountRole } = useAuth();
  const isAdmin = accountRole === "admin" || accountRole === "owner";
  const { startCall, callable, phase, wrapUp } = useTelephony();

  // ---- Cola ----
  const [scope, setScope] = useState<QueueScope>("mine");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<CollectionQueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  // ---- Ficha ----
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>(EMPTY_DETAIL);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [outcomes, setOutcomes] = useState<CollectionOutcome[]>([]);
  const [knowledgeBase, setKnowledgeBase] = useState<string | null>(null);

  // ---- Acciones ----
  const [claiming, setClaiming] = useState(false);
  const [linkedCall, setLinkedCall] = useState<LinkedCall | null>(null);
  const [payment, setPayment] = useState<CollectionInstallment | null>(null);

  const selected = useMemo(
    () => rows.find((row) => row.debtor_id === selectedId) ?? null,
    [rows, selectedId]
  );

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const params = new URLSearchParams({
        scope,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (appliedSearch) params.set("q", appliedSearch);

      const response = await fetch(`/api/cobranza/desk?${params.toString()}`);
      const json = (await response.json().catch(() => ({}))) as {
        rows?: CollectionQueueRow[];
        total?: number;
        error?: string;
      };

      if (!response.ok) {
        setRows([]);
        setTotal(0);
        setQueueError(
          json.error ?? "No se pudo cargar la cola de trabajo."
        );
        return;
      }

      const list = json.rows ?? [];
      setRows(list);
      setTotal(Number(json.total) || 0);
      setSelectedId((current) => {
        if (current && list.some((row) => row.debtor_id === current)) {
          return current;
        }
        return list[0]?.debtor_id ?? null;
      });
    } catch {
      setRows([]);
      setTotal(0);
      setQueueError("Sin conexión con el servidor.");
    } finally {
      setLoadingQueue(false);
    }
  }, [appliedSearch, offset, scope]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadQueue();
  }, [loadQueue]);

  const loadDetail = useCallback(
    async (debtorId: string) => {
      setLoadingDetail(true);
      const [creditRes, installmentRes, promiseRes, actionRes] =
        await Promise.all([
          supabase
            .from("collection_credits")
            .select("*")
            .eq("debtor_id", debtorId)
            .order("created_at", { ascending: true }),
          supabase
            .from("collection_installments")
            .select("*")
            .eq("debtor_id", debtorId)
            .order("due_date", { ascending: true }),
          supabase
            .from("collection_promises")
            .select("*")
            .eq("debtor_id", debtorId)
            .order("due_date", { ascending: true }),
          supabase
            .from("collection_actions")
            .select("*")
            .eq("debtor_id", debtorId)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

      setLoadingDetail(false);

      const failed =
        creditRes.error || installmentRes.error || promiseRes.error || actionRes.error;
      if (failed) {
        console.error("[cobranza/consola] detalle", failed);
        toast.error("No se pudo cargar la ficha del deudor");
        return;
      }

      setDetail({
        credits: (creditRes.data ?? []) as CollectionCredit[],
        installments: (installmentRes.data ?? []) as CollectionInstallment[],
        promises: (promiseRes.data ?? []) as CollectionPromise[],
        actions: (actionRes.data ?? []) as CollectionAction[],
      });
    },
    [supabase]
  );

  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(EMPTY_DETAIL);
      return;
    }
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  // Catálogo de tipificaciones (solo para traducir el historial) y
  // enlace a la wiki. `select('*')` evita romper si la 125 aún no está.
  useEffect(() => {
    let active = true;
    void (async () => {
      let outcomeQuery = supabase
        .from("collection_outcomes")
        .select("id, account_id, code, label, level, parent_code, requires_amount, requires_date, requires_reason, active, sort, created_at")
        .eq("active", true);
      if (accountId) {
        outcomeQuery = outcomeQuery.or(
          `account_id.is.null,account_id.eq.${accountId}`
        );
      }

      const [outcomeRes, settingsRes] = await Promise.all([
        outcomeQuery,
        supabase.from("collection_settings").select("*").maybeSingle(),
      ]);
      if (!active) return;
      if (outcomeRes.data) {
        setOutcomes(outcomeRes.data as CollectionOutcome[]);
      }
      const url = (settingsRes.data as { knowledge_base_url?: unknown } | null)
        ?.knowledge_base_url;
      setKnowledgeBase(typeof url === "string" && url.trim() ? url.trim() : null);
    })();
    return () => {
      active = false;
    };
  }, [accountId, supabase]);

  // La llamada cerrada trae la duración real: se guarda para que la
  // gestión quede vinculada aunque el agente cierre el wrap-up.
  useEffect(() => {
    if (!wrapUp || !selectedId) return;
    const matches =
      wrapUp.call.collection_debtor_id === selectedId ||
      wrapUp.call.id === linkedCall?.id;
    if (matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedCall({ id: wrapUp.call.id, seconds: wrapUp.seconds });
    }
  }, [linkedCall?.id, selectedId, wrapUp]);

  const outcomeLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const outcome of outcomes) {
      if (outcome.account_id || !map.has(outcome.code)) {
        map.set(outcome.code, outcome.label);
      }
    }
    return map;
  }, [outcomes]);

  function chooseScope(next: QueueScope) {
    if (next === scope) return;
    setScope(next);
    setOffset(0);
  }

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    setOffset(0);
    const normalized = normalizeQueueSearch(search);
    setSearch(normalized);
    setAppliedSearch(normalized);
  }

  function clearSearch() {
    setSearch("");
    setAppliedSearch("");
    setOffset(0);
  }

  function selectDebtor(id: string) {
    if (id === selectedId) return;
    setSelectedId(id);
    setLinkedCall(null);
  }

  async function toggleClaim(action: "claim" | "release") {
    if (!selected) return;
    setClaiming(true);
    try {
      const response = await fetch(
        `/api/cobranza/debtors/${selected.debtor_id}/claim`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        toast.error(json.error ?? "No se pudo actualizar la asignación");
        return;
      }
      toast.success(
        action === "claim"
          ? `Tomaste a ${selected.name}`
          : "Deudor devuelto a la cola"
      );

      // Tomar desde "Sin asignar" mueve al gestor a su propia cola,
      // que es donde va a seguir trabajando el caso.
      if (action === "claim" && scope === "unassigned") {
        setOffset(0);
        setScope("mine");
        await loadDetail(selected.debtor_id);
      } else {
        await Promise.all([loadQueue(), loadDetail(selected.debtor_id)]);
      }
    } catch {
      toast.error("Sin conexión con el servidor");
    } finally {
      setClaiming(false);
    }
  }

  async function callDebtor() {
    if (!selected) return;
    if (!selected.phone_primary) {
      toast.error("El deudor no tiene teléfono registrado");
      return;
    }
    const call = await startCall(selected.phone_primary, {
      collectionDebtorId: selected.debtor_id,
    });
    if (call) setLinkedCall({ id: call.id, seconds: null });
  }

  async function handleSaved() {
    if (!selected) return;
    setLinkedCall(null);
    await Promise.all([loadQueue(), loadDetail(selected.debtor_id)]);
  }

  async function refreshAll() {
    await Promise.all([
      loadQueue(),
      selectedId ? loadDetail(selectedId) : Promise.resolve(),
    ]);
  }

  const days = selected ? daysOverdueFromRow(selected) : 0;
  const openPromises = selected?.open_promises ?? 0;
  const nextPromise = selected?.next_promise_due ?? null;
  const isMine = selected?.is_mine ?? false;
  const claimedByOther = Boolean(selected?.assigned_to) && !isMine;
  const canClaim = !claimedByOther || isAdmin;
  const pageEnd = offset + rows.length;
  const hasPrev = offset > 0;
  const hasNext = pageEnd < total;
  const dialing = phase === "connecting" || phase === "ringing" || phase === "active";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Consola de cobranza
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Tu cola del día, la ficha completa y la gestión en una sola
            pantalla. La cola prioriza promesas vencidas y mora.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Link
              href="/cobranza/supervision"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Gauge className="mr-2 h-4 w-4" />
              Supervisión
            </Link>
          ) : null}
          {knowledgeBase ? (
            <a
              href={knowledgeBase}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <BookOpen className="mr-2 h-4 w-4" />
              Guiones
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </a>
          ) : isAdmin ? (
            <Link
              href="/cobranza/configuracion"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <BookOpen className="mr-2 h-4 w-4" />
              Configurar guiones
            </Link>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshAll()}
            disabled={loadingQueue}
          >
            {loadingQueue ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Actualizar
          </Button>
        </div>
      </div>

      {queueError ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {queueError}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[310px_minmax(0,1fr)_360px]">
        {/* ------------------------------------------------ Cola */}
        <aside className="space-y-3 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto xl:pr-1">
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Cola de trabajo
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {total} deudor{total === 1 ? "" : "es"}
                  </p>
                </div>
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {QUEUE_SCOPES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => chooseScope(option.value)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                      scope === option.value
                        ? "border-primary/60 bg-primary/15 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <form onSubmit={applySearch} className="mt-3 flex gap-1.5">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Nombre, cédula o teléfono"
                    className="h-8 pl-8 pr-7 text-xs"
                  />
                  {search ? (
                    <button
                      type="button"
                      onClick={clearSearch}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label="Limpiar búsqueda"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <Button type="submit" size="sm" variant="outline" className="h-8 px-2">
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </form>
            </div>

            <div className="space-y-1.5 p-2">
              {loadingQueue ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cargando cola…
                </div>
              ) : rows.length === 0 ? (
                <div className="px-2 py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No hay deudores en este filtro.
                  </p>
                  {scope === "mine" ? (
                    <button
                      type="button"
                      onClick={() => chooseScope("unassigned")}
                      className="mt-2 text-xs font-medium text-primary hover:underline"
                    >
                      Ver deudores sin asignar
                    </button>
                  ) : null}
                </div>
              ) : (
                rows.map((row) => (
                  <QueueItem
                    key={row.debtor_id}
                    row={row}
                    active={row.debtor_id === selectedId}
                    onClick={() => selectDebtor(row.debtor_id)}
                  />
                ))
              )}
            </div>

            {total > PAGE_SIZE ? (
              <div className="flex items-center justify-between border-t border-border px-2 py-2 text-xs text-muted-foreground">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  disabled={!hasPrev || loadingQueue}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span>
                  {offset + 1}–{pageEnd} de {total}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  disabled={!hasNext || loadingQueue}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Orden de la cola
            </p>
            <ul className="mt-2 space-y-1.5">
              {QUEUE_RANKS.map((rank) => (
                <li key={rank.value} className="flex items-center gap-2 text-xs">
                  <span className={cn("h-2 w-2 rounded-full border", rank.tone)} />
                  <span className="text-muted-foreground">{rank.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* ------------------------------------------------ Ficha */}
        <section className="min-w-0 space-y-4">
          {!selected ? (
            <Panel>
              <EmptyState
                icon={Users}
                title="Elige un deudor de la cola"
                hint="A la izquierda están tus casos ordenados por riesgo: promesas vencidas, mora y luego los que aún están al día."
              />
            </Panel>
          ) : (
            <>
              <Panel
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {selected.name}
                    <StatusChip
                      label={labelFor(COLLECTION_SEGMENTS, selected.segment)}
                      tone={SEGMENT_TONE[selected.segment]}
                    />
                    <StatusChip
                      label={labelFor(COLLECTION_DEBTOR_STATUSES, selected.status)}
                      tone={DEBTOR_STATUS_TONE[selected.status as CollectionDebtorStatus]}
                    />
                  </span>
                }
                subtitle={
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{selected.document_number ?? "Sin cédula"}</span>
                    <span>{selected.phone_primary ?? "Sin teléfono"}</span>
                    {selected.email ? <span>{selected.email}</span> : null}
                  </span>
                }
                actions={
                  <>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void callDebtor()}
                      disabled={!callable || !selected.phone_primary || dialing}
                    >
                      {dialing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Phone className="mr-2 h-4 w-4" />
                      )}
                      Llamar
                    </Button>
                    {selected.phone_primary ? (
                      <a
                        href={whatsappHref(selected.phone_primary)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        <MessageCircle className="mr-2 h-4 w-4" />
                        WhatsApp
                      </a>
                    ) : null}
                  </>
                }
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Última gestión:{" "}
                    {selected.last_action_at
                      ? formatDateTime(selected.last_action_at)
                      : "nunca"}
                  </span>
                  {selected.last_level1 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-muted-foreground">
                      {outcomeLabels.get(selected.last_level1) ?? selected.last_level1}
                      {selected.last_level2
                        ? ` · ${outcomeLabels.get(selected.last_level2) ?? selected.last_level2}`
                        : ""}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1",
                      isMine
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : claimedByOther
                          ? "border-border bg-muted/40 text-muted-foreground"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    )}
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    {isMine
                      ? "Tu deudor"
                      : claimedByOther
                        ? `Asignado a ${selected.agent_name ?? "otro gestor"}`
                        : "Sin asignar"}
                  </span>

                  <div className="ml-auto flex items-center gap-2">
                    {!isMine ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void toggleClaim("claim")}
                        disabled={claiming || !canClaim}
                        title={
                          canClaim
                            ? "Tomar este deudor"
                            : `Lo tiene ${selected.agent_name ?? "otro gestor"}`
                        }
                      >
                        {claiming ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <UserCheck className="mr-2 h-4 w-4" />
                        )}
                        Tomar
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void toggleClaim("release")}
                        disabled={claiming}
                      >
                        Soltar
                      </Button>
                    )}
                  </div>
                </div>

                {selected.priority_reason ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Prioridad:</span>{" "}
                    {selected.priority_reason}
                  </p>
                ) : null}
              </Panel>

              <div className="grid gap-3 sm:grid-cols-2">
                <MetricCard
                  title="Saldo total"
                  value={formatUsd(selected.balance)}
                  icon={Wallet}
                  subtitle={`${selected.open_installments} cuota${
                    selected.open_installments === 1 ? "" : "s"
                  } abierta${selected.open_installments === 1 ? "" : "s"}`}
                />
                <MetricCard
                  title="Saldo vencido"
                  value={formatUsd(selected.overdue_balance)}
                  icon={Clock}
                  subtitle={
                    days > 0 ? `${days} días de mora` : "Sin cuotas vencidas"
                  }
                />
                <MetricCard
                  title="Promesas abiertas"
                  value={String(openPromises)}
                  icon={Handshake}
                  subtitle={
                    nextPromise
                      ? `Próxima: ${dueLabel(nextPromise, todayIso())}`
                      : "Sin PTP vigente"
                  }
                />
                <MetricCard
                  title="Prioridad"
                  value={String(Math.round(Number(selected.priority_score) || 0))}
                  icon={PhoneCall}
                  subtitle={queueRankLabel(selected.queue_rank)}
                />
              </div>

              <Panel
                title="Créditos y cuotas"
                subtitle="Registra el pago en la cuota que corresponda"
              >
                {loadingDetail ? (
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cargando ficha…
                  </div>
                ) : detail.credits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Este deudor no tiene créditos cargados.
                  </p>
                ) : (
                  <div className="space-y-5">
                    {detail.credits.map((credit) => {
                      const creditInstallments = detail.installments.filter(
                        (installment) => installment.credit_id === credit.id
                      );
                      const openBalance = creditInstallments.reduce(
                        (sum, installment) =>
                          installment.status === "pending" ||
                          installment.status === "partial"
                            ? sum + installmentBalance(installment)
                            : sum,
                        0
                      );

                      return (
                        <div key={credit.id}>
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {credit.folio}
                                {credit.product ? ` · ${credit.product}` : ""}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Total {formatUsd(credit.total)} · saldo abierto{" "}
                                {formatUsd(openBalance)}
                              </p>
                            </div>
                            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              {credit.status}
                            </span>
                          </div>

                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>#</TableHead>
                                  <TableHead>Vence</TableHead>
                                  <TableHead className="text-right">Total</TableHead>
                                  <TableHead className="text-right">Pagado</TableHead>
                                  <TableHead className="text-right">Saldo</TableHead>
                                  <TableHead>Estado</TableHead>
                                  <TableHead />
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {creditInstallments.map((installment) => {
                                  const balance = installmentBalance(installment);
                                  const overdue = isInstallmentOverdue(installment);
                                  return (
                                    <TableRow key={installment.id}>
                                      <TableCell className="tabular-nums">
                                        {installment.number}
                                      </TableCell>
                                      <TableCell className="whitespace-nowrap">
                                        <span
                                          className={cn(
                                            overdue && "font-medium text-red-300"
                                          )}
                                        >
                                          {formatDate(installment.due_date)}
                                        </span>
                                        {overdue ? (
                                          <span className="ml-1.5 text-[11px] text-red-300">
                                            +{daysOverdue(installment.due_date)}d
                                          </span>
                                        ) : null}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {formatUsd(installment.total)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {formatUsd(installment.paid_amount)}
                                      </TableCell>
                                      <TableCell className="text-right font-medium tabular-nums">
                                        {formatUsd(balance)}
                                      </TableCell>
                                      <TableCell>
                                        <StatusChip
                                          label={labelFor(
                                            COLLECTION_INSTALLMENT_STATUSES,
                                            installment.status
                                          )}
                                          tone={INSTALLMENT_STATUS_TONE[installment.status]}
                                        />
                                      </TableCell>
                                      <TableCell className="text-right">
                                        {balance > 0 ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => setPayment(installment)}
                                          >
                                            <Wallet className="mr-1.5 h-3.5 w-3.5" />
                                            Pagar
                                          </Button>
                                        ) : null}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Promesas de pago" subtitle="Acuerdos del deudor">
                  {detail.promises.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Sin promesas registradas.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.promises.map((promise) => (
                        <li
                          key={promise.id}
                          className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium tabular-nums text-foreground">
                              {formatUsd(promise.amount)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(promise.due_date)} ·{" "}
                              {dueLabel(promise.due_date, todayIso())}
                            </p>
                          </div>
                          <StatusChip
                            label={labelFor(COLLECTION_PROMISE_STATUSES, promise.status)}
                            tone={PROMISE_STATUS_TONE[promise.status]}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <Panel title="Últimas gestiones" subtitle="Bitácora del deudor">
                  {detail.actions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Aún no hay gestiones registradas.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.actions.map((action) => (
                        <li
                          key={action.id}
                          className="rounded-lg border border-border bg-muted/20 px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-medium text-foreground">
                              {outcomeLabels.get(action.level1_code) ??
                                action.level1_code}
                              {action.level2_code
                                ? ` · ${
                                    outcomeLabels.get(action.level2_code) ??
                                    action.level2_code
                                  }`
                                : ""}
                            </p>
                            <span className="text-[11px] text-muted-foreground">
                              {formatDateTime(action.created_at)}
                              {action.user_id === user?.id ? " · Tú" : ""}
                            </span>
                          </div>
                          {action.notes ? (
                            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                              {action.notes}
                            </p>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{action.channel}</span>
                            {typeof action.call_duration_seconds === "number" ? (
                              <span>
                                {formatDuration(action.call_duration_seconds)}
                              </span>
                            ) : null}
                            {action.call_session_id ? (
                              <span className="inline-flex items-center gap-1 text-emerald-300">
                                <Phone className="h-3 w-3" />
                                llamada vinculada
                              </span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
            </>
          )}
        </section>

        {/* ------------------------------------------------ Gestión */}
        <aside className="space-y-3 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto xl:pl-1">
          {!selected ? (
            <Panel title="Gestión">
              <p className="text-sm text-muted-foreground">
                Selecciona un deudor para registrar la llamada.
              </p>
            </Panel>
          ) : (
            <>
              <Panel
                title="Llamada"
                subtitle={
                  dialing
                    ? "Llamada en curso en el softphone"
                    : "Marca y la gestión queda ligada a la llamada"
                }
                actions={
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void callDebtor()}
                    disabled={!callable || !selected.phone_primary || dialing}
                  >
                    <Phone className="mr-1.5 h-3.5 w-3.5" />
                    Marcar
                  </Button>
                }
              >
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p className="text-foreground">
                    {selected.phone_primary ?? "Sin teléfono registrado"}
                  </p>
                  {linkedCall ? (
                    <p className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
                      <PhoneCall className="h-3.5 w-3.5" />
                      Llamada vinculada
                      {typeof linkedCall.seconds === "number"
                        ? ` · ${formatDuration(linkedCall.seconds)}`
                        : ""}
                    </p>
                  ) : (
                    <p>
                      Si marcas desde aquí, la gestión guarda el vínculo con la
                      llamada y su duración.
                    </p>
                  )}
                  {!callable ? (
                    <p className="text-amber-300">
                      El softphone no está listo. Revisa Telefonía.
                    </p>
                  ) : null}
                </div>
              </Panel>

              <Panel
                title="Registrar gestión"
                subtitle="Tipificación obligatoria"
              >
                <ActionForm
                  key={selected.debtor_id}
                  debtorId={selected.debtor_id}
                  debtorName={selected.name}
                  daysOverdue={days}
                  overdueBalance={selected.overdue_balance}
                  balance={selected.balance}
                  isAdmin={isAdmin}
                  accountId={accountId}
                  callSession={linkedCall}
                  onSaved={() => void handleSaved()}
                />
              </Panel>

              <Panel title="Siguiente" subtitle="Después de guardar">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Avanza al siguiente deudor de la cola sin volver al
                    principio.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={!nextRow(rows, selectedId)}
                    onClick={() => {
                      const next = nextRow(rows, selectedId);
                      if (next) selectDebtor(next.debtor_id);
                    }}
                  >
                    Siguiente deudor
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                  <Link
                    href={`/cobranza/cartera/${selected.debtor_id}`}
                    className={buttonVariants({
                      variant: "ghost",
                      size: "sm",
                      className: "w-full",
                    })}
                  >
                    Ver ficha completa
                  </Link>
                </div>
              </Panel>
            </>
          )}
        </aside>
      </div>

      <PaymentDialog
        installment={payment}
        open={Boolean(payment)}
        onOpenChange={(open) => {
          if (!open) setPayment(null);
        }}
        onSaved={() => {
          setPayment(null);
          if (selected) {
            void Promise.all([loadQueue(), loadDetail(selected.debtor_id)]);
          }
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------
// Piezas
// ------------------------------------------------------------

function QueueItem({
  row,
  active,
  onClick,
}: {
  row: CollectionQueueRow;
  active: boolean;
  onClick: () => void;
}) {
  const promiseDue = row.next_promise_due;
  const days = daysOverdueFromRow(row);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border p-2.5 text-left transition",
        active
          ? "border-primary/60 bg-primary/10"
          : "border-border bg-muted/20 hover:border-border hover:bg-muted/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full border", queueRankTone(row.queue_rank))}
            title={queueRankLabel(row.queue_rank)}
          />
          <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
        </div>
        <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">
          {formatUsd(row.balance)}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          {row.document_number ?? "Sin cédula"}
          {row.phone_primary ? ` · ${row.phone_primary}` : ""}
        </span>
        <span className="shrink-0">{SEGMENT_LABELS[row.segment as CollectionSegment] ?? row.segment}</span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        {row.overdue_balance > 0 ? (
          <span className="text-red-300">
            Vencido {formatUsd(row.overdue_balance)}
            {days > 0 ? ` · ${days}d` : ""}
          </span>
        ) : null}
        {promiseDue ? (
          <span className="text-amber-300">
            PTP {dueLabel(promiseDue, todayIso())}
          </span>
        ) : null}
        {row.broken_promises > 0 ? (
          <span className="text-red-300">
            {row.broken_promises} PTP rota{row.broken_promises === 1 ? "" : "s"}
          </span>
        ) : null}
        {!row.assigned_to ? (
          <span className="text-muted-foreground">Sin asignar</span>
        ) : row.is_mine ? (
          <span className="text-primary">Tuyo</span>
        ) : (
          <span className="truncate text-muted-foreground">{row.agent_name}</span>
        )}
      </div>
    </button>
  );
}

function StatusChip({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone
      )}
    >
      {label}
    </span>
  );
}

// ------------------------------------------------------------
// Utilidades de presentación
// ------------------------------------------------------------

function daysOverdueFromRow(row: CollectionQueueRow): number {
  return Number(row.days_overdue_max) || 0;
}

function nextRow(
  rows: CollectionQueueRow[],
  currentId: string | null
): CollectionQueueRow | null {
  if (!currentId) return rows[0] ?? null;
  const index = rows.findIndex((row) => row.debtor_id === currentId);
  if (index < 0) return rows[0] ?? null;
  return rows[index + 1] ?? null;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-VE", {
    timeZone: "America/Caracas",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

/** Enlace de WhatsApp a partir del teléfono tal como está guardado. */
function whatsappHref(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `58${digits.slice(1)}`;
  return `https://wa.me/${digits}`;
}
