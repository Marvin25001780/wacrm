"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Filter,
  RefreshCw,
  Search,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DebtorTable } from "@/components/collections/debtor-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { formatUsd } from "@/lib/collections/format";
import {
  COLLECTION_DEBTOR_STATUSES,
  COLLECTION_SEGMENTS,
  type CollectionDebtorSummary,
} from "@/types/collections";
import { cn } from "@/lib/utils";

type SortKey = "priority" | "balance" | "overdue" | "name";

const selectClass =
  "h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function CarteraPage() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canImport = useCan("edit-settings");
  const canOperate = useCan("send-messages");

  const [rows, setRows] = useState<CollectionDebtorSummary[]>([]);
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [portfolios, setPortfolios] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [portfolio, setPortfolio] = useState("all");
  const [segment, setSegment] = useState("all");
  const [status, setStatus] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("priority");

  useEffect(() => {
    // El wizard enlaza aquí con ?portfolio=<id> tras importar.
    const requested = new URLSearchParams(window.location.search).get("portfolio");
    if (requested) setPortfolio(requested);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [debtorsRes, profilesRes, portfoliosRes] = await Promise.all([
      supabase
        .from("v_collection_debtor_summary")
        .select("*")
        .order("priority_score", { ascending: false })
        .limit(1000),
      supabase.from("profiles").select("id, full_name, email"),
      supabase
        .from("collection_portfolios")
        .select("id, name")
        .order("created_at", { ascending: false }),
    ]);
    setLoading(false);

    if (debtorsRes.error) {
      console.error("[cobranza/cartera] load error", debtorsRes.error);
      setLoadError(debtorsRes.error.message);
      toast.error("No se pudo cargar la cartera");
      return;
    }

    setLoadError(null);
    setRows((debtorsRes.data ?? []) as CollectionDebtorSummary[]);
    setPortfolios((portfoliosRes.data ?? []) as { id: string; name: string }[]);

    const map: Record<string, string> = {};
    for (const profile of profilesRes.data ?? []) {
      map[profile.id as string] =
        (profile.full_name as string | null) ?? (profile.email as string | null) ?? "Usuario";
    }
    setAssignees(map);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, accountId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    const result = rows.filter((row) => {
      if (portfolio !== "all" && row.portfolio_id !== portfolio) return false;
      if (segment !== "all" && row.segment !== segment) return false;
      if (status !== "all" && row.status !== status) return false;
      if (overdueOnly && Number(row.overdue_balance) <= 0) return false;
      if (!term) return true;

      return (
        row.name.toLowerCase().includes(term) ||
        (row.document_number ?? "").toLowerCase().includes(term) ||
        (row.phone_primary ?? "").toLowerCase().includes(term) ||
        (row.email ?? "").toLowerCase().includes(term)
      );
    });

    result.sort((a, b) => {
      if (sort === "balance") return Number(b.balance) - Number(a.balance);
      if (sort === "overdue") return Number(b.overdue_balance) - Number(a.overdue_balance);
      if (sort === "name") return a.name.localeCompare(b.name, "es");
      return Number(b.priority_score) - Number(a.priority_score);
    });

    return result;
  }, [rows, search, portfolio, segment, status, overdueOnly, sort]);

  const summary = useMemo(
    () => ({
      count: filtered.length,
      balance: filtered.reduce((sum, row) => sum + Number(row.balance || 0), 0),
      overdue: filtered.reduce((sum, row) => sum + Number(row.overdue_balance || 0), 0),
      priority:
        filtered.length > 0
          ? filtered.reduce((sum, row) => sum + Number(row.priority_score || 0), 0) /
            filtered.length
          : 0,
    }),
    [filtered],
  );

  async function recompute() {
    setRecomputing(true);
    try {
      const response = await fetch("/api/cobranza/priorities/recompute", { method: "POST" });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "No se pudo recalcular.");
      toast.success("Prioridades actualizadas");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo recalcular.");
    } finally {
      setRecomputing(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setPortfolio("all");
    setSegment("all");
    setStatus("all");
    setOverdueOnly(false);
    setSort("priority");
  }

  const hasFilters =
    search.trim() !== "" ||
    portfolio !== "all" ||
    segment !== "all" ||
    status !== "all" ||
    overdueOnly;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cartera</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Deudores, saldos y prioridad de gestión.
            {rows.length >= 1000 ? " Mostrando los primeros 1.000." : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canOperate ? (
            <Button type="button" variant="outline" onClick={recompute} disabled={recomputing}>
              <RefreshCw className={cn("mr-2 h-4 w-4", recomputing && "animate-spin")} />
              Recalcular
            </Button>
          ) : null}
          {canImport ? (
            <Button variant="outline" render={<Link href="/cobranza/pagos" />}>
              <Wallet className="mr-2 h-4 w-4" />
              Carga de pagos
            </Button>
          ) : null}
          {canImport ? (
            <Button render={<Link href="/cobranza/importar" />}>
              <Upload className="mr-2 h-4 w-4" />
              Carga masiva
            </Button>
          ) : null}
        </div>
      </div>

      {loadError ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>No se pudo consultar la cartera: {loadError}</span>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Deudores"
          value={String(summary.count)}
          icon={Users}
          subtitle="En cartera activa"
        />
        <MetricCard
          title="Saldo total"
          value={formatUsd(summary.balance)}
          icon={Wallet}
          subtitle="Cuotas pendientes"
        />
        <MetricCard
          title="Saldo vencido"
          value={formatUsd(summary.overdue)}
          icon={AlertTriangle}
          subtitle={
            summary.balance > 0
              ? `${((summary.overdue / summary.balance) * 100).toFixed(1)}% de la cartera`
              : "Sin saldo"
          }
        />
        <MetricCard
          title="Prioridad promedio"
          value={summary.priority.toFixed(1)}
          icon={Filter}
          subtitle="Índice 0-100"
        />
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre, documento, teléfono o email"
              className="pl-8"
            />
          </div>

          <select
            value={portfolio}
            onChange={(event) => setPortfolio(event.target.value)}
            className={selectClass}
            aria-label="Cartera"
          >
            <option value="all">Todas las carteras</option>
            {portfolios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>

          <select
            value={segment}
            onChange={(event) => setSegment(event.target.value)}
            className={selectClass}
            aria-label="Segmento"
          >
            <option value="all">Todos los segmentos</option>
            {COLLECTION_SEGMENTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={selectClass}
            aria-label="Estado"
          >
            <option value="all">Todos los estados</option>
            {COLLECTION_DEBTOR_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className={selectClass}
            aria-label="Orden"
          >
            <option value="priority">Prioridad</option>
            <option value="balance">Mayor saldo</option>
            <option value="overdue">Mayor vencido</option>
            <option value="name">Nombre</option>
          </select>

          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(event) => setOverdueOnly(event.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Solo vencidos
          </label>

          {hasFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-1 h-3.5 w-3.5" />
              Limpiar
            </Button>
          ) : null}
        </div>

        <div className="p-2 sm:p-4">
          {!loading && rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Users}
                title="Sin deudores en cartera"
                hint="Carga un Excel o CSV para empezar. El importador valida cada fila antes de crear deudores, créditos y cuotas."
              />
              {canImport ? (
                <div className="mt-4 flex justify-center">
                  <Button render={<Link href="/cobranza/importar" />}>
                    <Upload className="mr-2 h-4 w-4" />
                    Cargar cartera
                  </Button>
                </div>
              ) : null}
            </div>
          ) : filtered.length === 0 && !loading ? (
            <div className="p-4">
              <EmptyState
                icon={Search}
                title="No hay resultados"
                hint="Ajusta la búsqueda o limpia los filtros."
              />
            </div>
          ) : (
            <DebtorTable
              rows={filtered}
              loading={loading}
              assigneeNames={assignees}
            />
          )}
        </div>
      </div>
    </div>
  );
}
