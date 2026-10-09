"use client";

// ============================================================
// Reportes de cartera — módulo 2.5.
// Analítica derivada de Cobranza (sin migración): resumen, aging de
// saldos, tendencia de cobros por mes, desglose por estado y top de
// clientes por saldo pendiente. Se renderiza por moneda.
// ============================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import { todayIso } from "@/lib/receivables/utils";
import {
  buildReceivablesReport,
  currenciesIn,
  type ReceivablesReport,
} from "@/lib/receivables/reports";
import { type Receivable } from "@/types";
import {
  ArrowLeft,
  Loader2,
  HandCoins,
  AlertTriangle,
  Wallet,
  Percent,
  BarChart3,
} from "lucide-react";

const STATUS_BADGE: Record<string, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  partial: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  cancelled: "border-border bg-muted text-muted-foreground",
};

export default function ReceivablesReportsPage() {
  const supabase = createClient();
  const { defaultCurrency, accountId } = useAuth();

  const [rows, setRows] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState<string>(defaultCurrency);
  const [months, setMonths] = useState<number>(6);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("receivables")
      .select(
        "*, contact:contacts(id, name), organization:organizations(id, name), payments:receivable_payments(*)",
      )
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      console.error("[receivables-reports] fetch error:", error);
      toast.error("Error al cargar el reporte");
      return;
    }
    setRows((data ?? []) as unknown as Receivable[]);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, accountId]);

  const currencies = useMemo(() => {
    const list = currenciesIn(rows);
    if (list.length === 0) return [defaultCurrency];
    return list;
  }, [rows, defaultCurrency]);

  // Mantén la moneda seleccionada dentro de las disponibles.
  useEffect(() => {
    if (currencies.length > 0 && !currencies.includes(currency)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrency(currencies[0]);
    }
  }, [currencies, currency]);

  const report: ReceivablesReport = useMemo(
    () => buildReceivablesReport(rows, { todayIso: todayIso(), currency, months }),
    [rows, currency, months],
  );

  const hasData = rows.length > 0;
  const maxAging = Math.max(1, ...report.aging.map((a) => a.amount));
  const maxMonth = Math.max(1, ...report.monthly.map((m) => m.amount));
  const topCounterparties = report.byCounterparty.slice(0, 8);
  const overdueShare =
    report.totals.pending > 0 ? report.totals.overdue / report.totals.pending : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/receivables"
            className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Volver a Cobranza
          </Link>
          <h1 className="text-2xl font-bold text-foreground">Reportes de cartera</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Antigüedad de saldos, cobros y concentración por cliente.
          </p>
        </div>
        {hasData && (
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground outline-none focus-visible:border-ring"
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="flex rounded-lg border border-border bg-card p-0.5">
              {[6, 12].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMonths(m)}
                  className={
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors " +
                    (months === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {m} meses
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : !hasData ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-16 text-muted-foreground">
          <HandCoins className="size-8" />
          <p className="text-sm">Aún no hay cuentas por cobrar para analizar.</p>
          <Link href="/receivables" className="text-xs text-primary hover:underline">
            Ir a Cobranza
          </Link>
        </div>
      ) : (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard
              icon={Wallet}
              label="Por cobrar"
              value={formatCurrency(report.totals.pending, currency)}
              hint={`${report.totals.count} cuenta${report.totals.count === 1 ? "" : "s"} activa${report.totals.count === 1 ? "" : "s"}`}
            />
            <SummaryCard
              icon={AlertTriangle}
              label="Vencido"
              value={formatCurrency(report.totals.overdue, currency)}
              hint={`${Math.round(overdueShare * 100)}% del saldo · ${report.totals.overdueCount} cuenta${report.totals.overdueCount === 1 ? "" : "s"}`}
              tone="rose"
            />
            <SummaryCard
              icon={HandCoins}
              label="Cobrado"
              value={formatCurrency(report.totals.collected, currency)}
              hint={`de ${formatCurrency(report.totals.invoiced, currency)} facturado`}
              tone="emerald"
            />
            <SummaryCard
              icon={Percent}
              label="Tasa de cobro"
              value={`${Math.round(report.totals.collectionRate * 100)}%`}
              hint="cobrado / facturado"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Aging */}
            <section className="rounded-lg border border-border bg-card">
              <header className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Antigüedad de saldos</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Saldo pendiente por antigüedad de vencimiento
                </p>
              </header>
              <div className="space-y-3 p-4">
                {report.aging.map((a) => (
                  <div key={a.key}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className={a.overdue ? "text-muted-foreground" : "text-foreground"}>
                        {a.label}
                        {a.count > 0 && (
                          <span className="ml-1.5 text-muted-foreground">
                            ({a.count})
                          </span>
                        )}
                      </span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(a.amount, currency)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={
                          "h-full rounded-full " +
                          (a.key === "current"
                            ? "bg-emerald-500/70"
                            : a.key === "d1_30"
                              ? "bg-amber-500/80"
                              : a.key === "d31_60"
                                ? "bg-orange-500/80"
                                : a.key === "d61_90"
                                  ? "bg-rose-500/80"
                                  : "bg-rose-600")
                        }
                        style={{ width: `${Math.round((a.amount / maxAging) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Tendencia de cobros */}
            <section className="rounded-lg border border-border bg-card">
              <header className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Cobros por mes</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Abonos registrados en los últimos {months} meses
                </p>
              </header>
              <div className="p-4">
                <div className="flex h-40 items-end gap-2">
                  {report.monthly.map((m) => (
                    <div key={m.key} className="flex flex-1 flex-col items-center gap-1.5">
                      <div className="flex w-full flex-1 items-end">
                        <div
                          className="w-full rounded-t bg-primary/70 transition-all"
                          style={{ height: `${Math.round((m.amount / maxMonth) * 100)}%` }}
                          title={formatCurrency(m.amount, currency)}
                        />
                      </div>
                      <span className="text-[11px] capitalize text-muted-foreground">{m.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Estado */}
            <section className="rounded-lg border border-border bg-card">
              <header className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Por estado</h2>
              </header>
              <ul className="divide-y divide-border">
                {report.byStatus.map((s) => (
                  <li key={s.status} className="flex items-center justify-between px-4 py-3">
                    <span
                      className={
                        "rounded-full border px-2 py-0.5 text-xs font-medium " +
                        (STATUS_BADGE[s.status] ?? "")
                      }
                    >
                      {s.label}
                    </span>
                    <span className="text-right text-sm">
                      <span className="font-medium text-foreground">
                        {formatCurrency(s.amount, currency)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {s.count} cuenta{s.count === 1 ? "" : "s"}
                        {s.balance > 0 && s.status !== "cancelled"
                          ? ` · saldo ${formatCurrency(s.balance, currency)}`
                          : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Clientes */}
            <section className="rounded-lg border border-border bg-card lg:col-span-2">
              <header className="flex items-center gap-2 border-b border-border px-4 py-3">
                <BarChart3 className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  Concentración por cliente
                </h2>
              </header>
              {topCounterparties.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Sin saldos pendientes.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2.5 font-medium">Cliente</th>
                        <th className="px-3 py-2.5 text-center font-medium">Cuentas</th>
                        <th className="px-3 py-2.5 text-right font-medium">Pendiente</th>
                        <th className="px-4 py-2.5 text-right font-medium">Vencido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topCounterparties.map((c) => (
                        <tr key={c.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 text-foreground">{c.name}</td>
                          <td className="px-3 py-2.5 text-center text-muted-foreground">
                            {c.count}
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium text-foreground">
                            {formatCurrency(c.pending, currency)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {c.overdue > 0 ? (
                              <span className="text-rose-400">
                                {formatCurrency(c.overdue, currency)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint?: string;
  tone?: "rose" | "emerald";
}) {
  const toneClass =
    tone === "rose" ? "text-rose-400" : tone === "emerald" ? "text-emerald-400" : "text-primary";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={"size-4 " + toneClass} />
        <p className="text-xs">{label}</p>
      </div>
      <p className="mt-1.5 truncate text-xl font-bold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
