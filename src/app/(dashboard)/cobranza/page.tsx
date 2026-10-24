"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  FileSpreadsheet,
  Handshake,
  RefreshCw,
  TrendingUp,
  Upload,
  Users,
  Wallet,
} from "lucide-react";

import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { Panel } from "@/components/metrics/panel";
import { PriorityBadge } from "@/components/collections/priority-badge";
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
import { useCan } from "@/hooks/use-can";
import { agingRows } from "@/lib/collections/aging";
import { formatDate, formatUsd, todayIso } from "@/lib/collections/format";
import type {
  CollectionAgingRow,
  CollectionDebtorSummary,
  CollectionPayment,
  CollectionPromise,
} from "@/types/collections";
import { cn } from "@/lib/utils";

interface RecentPayment extends CollectionPayment {
  debtor?: { name: string } | null;
}

export default function CobranzaPage() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canImport = useCan("edit-settings");
  const canOperate = useCan("send-messages");

  const [debtors, setDebtors] = useState<CollectionDebtorSummary[]>([]);
  const [aging, setAging] = useState<CollectionAgingRow | null>(null);
  const [payments, setPayments] = useState<RecentPayment[]>([]);
  const [promises, setPromises] = useState<CollectionPromise[]>([]);
  const [monthRecovered, setMonthRecovered] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const monthStart = `${todayIso().slice(0, 7)}-01`;

    const [debtorsRes, agingRes, paymentsRes, promisesRes, recoveredRes] = await Promise.all([
      supabase
        .from("v_collection_debtor_summary")
        .select("*")
        .order("priority_score", { ascending: false })
        .limit(1000),
      supabase.from("v_collection_aging").select("*").maybeSingle(),
      supabase
        .from("collection_payments")
        .select("*, debtor:collection_debtors(name)")
        .order("paid_at", { ascending: false })
        .limit(8),
      supabase.from("collection_promises").select("*").limit(1000),
      supabase
        .from("collection_payments")
        .select("amount")
        .gte("paid_at", monthStart)
        .limit(5000),
    ]);

    setLoading(false);

    if (debtorsRes.error || agingRes.error || paymentsRes.error || promisesRes.error) {
      console.error("[cobranza] load error", {
        debtors: debtorsRes.error,
        aging: agingRes.error,
        payments: paymentsRes.error,
        promises: promisesRes.error,
      });
      toast.error("No se pudo cargar el panel de cobranza");
      return;
    }

    setDebtors((debtorsRes.data ?? []) as CollectionDebtorSummary[]);
    setAging((agingRes.data ?? null) as CollectionAgingRow | null);
    setPayments((paymentsRes.data ?? []) as RecentPayment[]);
    setPromises((promisesRes.data ?? []) as CollectionPromise[]);
    setMonthRecovered(
      (recoveredRes.data ?? []).reduce(
        (sum, row) => sum + (Number((row as { amount: number }).amount) || 0),
        0,
      ),
    );
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, accountId]);

  const summary = useMemo(() => {
    const total = debtors.reduce((sum, row) => sum + Number(row.balance || 0), 0);
    const overdue = debtors.reduce((sum, row) => sum + Number(row.overdue_balance || 0), 0);
    const pendingPromises = promises.filter((row) => row.status === "pending").length;
    return {
      total,
      overdue,
      pendingPromises,
      debtors: debtors.length,
    };
  }, [debtors, promises]);

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

  const topDebtors = useMemo(
    () => [...debtors].sort((a, b) => b.priority_score - a.priority_score).slice(0, 6),
    [debtors],
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
        <SkeletonCard className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Panel de cobranza</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cartera, recuperación y prioridades de la operación.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canOperate ? (
            <Button type="button" variant="outline" onClick={recompute} disabled={recomputing}>
              <RefreshCw className={cn("mr-2 h-4 w-4", recomputing && "animate-spin")} />
              Recalcular prioridades
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Cartera total"
          value={formatUsd(summary.total)}
          icon={Wallet}
          subtitle={`${summary.debtors} deudores`}
        />
        <MetricCard
          title="Cartera vencida"
          value={formatUsd(summary.overdue)}
          icon={AlertTriangle}
          subtitle={
            summary.total > 0
              ? `${((summary.overdue / summary.total) * 100).toFixed(1)}% del saldo`
              : "Sin saldo pendiente"
          }
        />
        <MetricCard
          title="Recuperado del mes"
          value={formatUsd(monthRecovered)}
          icon={TrendingUp}
          subtitle="Pagos registrados en el mes"
        />
        <MetricCard
          title="PTP pendientes"
          value={String(summary.pendingPromises)}
          icon={Handshake}
          subtitle="Acuerdos por vencer"
        />
      </div>

      {debtors.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <EmptyState
            icon={FileSpreadsheet}
            title="Todavía no hay cartera"
            hint="Sube un Excel o CSV con deudores, créditos y cuotas. En minutos tendrás la cartera lista para gestionar."
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
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Aging de cartera" subtitle="Saldo pendiente por antigüedad">
              <div className="space-y-3">
                {agingRows(buckets).map((row) => {
                  const pct = buckets.total > 0 ? (row.value / buckets.total) * 100 : 0;
                  return (
                    <div key={row.key}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{row.label}</span>
                        <span className="font-medium tabular-nums">{formatUsd(row.value)}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel
              title="Top prioridad"
              subtitle="Deudores con mayor índice de gestión"
              actions={
                <Link
                  href="/cobranza/cartera"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Ver cartera
                  <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              <div className="space-y-2">
                {topDebtors.map((debtor) => (
                  <Link
                    key={debtor.id}
                    href={`/cobranza/cartera/${debtor.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{debtor.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {debtor.days_overdue_max > 0
                          ? `${debtor.days_overdue_max} días de mora`
                          : "Sin mora"}{" "}
                        · {formatUsd(debtor.balance)}
                      </p>
                    </div>
                    <PriorityBadge score={debtor.priority_score} />
                  </Link>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Últimos pagos" subtitle="Movimientos recientes de la cartera">
            {payments.length === 0 ? (
              <EmptyState icon={Wallet} title="Sin pagos registrados" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Deudor</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Referencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>{formatDate(payment.paid_at)}</TableCell>
                      <TableCell className="font-medium">{payment.debtor?.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-300">
                        {formatUsd(payment.amount)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{payment.method ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {payment.reference ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <QuickLink
          href="/cobranza/cartera"
          icon={Users}
          title="Cartera"
          description="Filtra, prioriza y abre la ficha 360."
        />
        {canImport ? (
          <QuickLink
            href="/cobranza/importar"
            icon={Upload}
            title="Carga masiva"
            description="Excel/CSV con mapeo y validación."
          />
        ) : null}
        <QuickLink
          href="/cobranza/reportes"
          icon={BarChart3}
          title="Reportes"
          description="Aging, recuperación y PTP."
        />
        <QuickLink
          href="/cobranza/configuracion"
          icon={Handshake}
          title="Políticas"
          description="Tramos, topes y comisiones."
        />
      </div>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof Users;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
        {title}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </Link>
  );
}
