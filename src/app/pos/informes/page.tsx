"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import { PosPageHeader } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, toNumber, usdToBs } from "@/lib/pos/money";

type Period = "month" | "lastMonth" | "days30" | "year";
type Tab = "resultados" | "ventas" | "finanzas";

interface SaleRow {
  subtotal_usd: number | string;
  unit_cost_usd: number | string;
  total_usd: number | string;
  balance_usd: number | string;
  status: string;
  created_at: string;
}

interface ReturnRow {
  subtotal_usd: number | string;
  cost_usd: number | string;
  created_at?: string;
}

interface TxRow {
  category: string;
  kind: "in" | "out";
  amount_usd: number | string;
  description: string | null;
  created_at: string;
}

interface LossRow {
  quantity: number | string;
  unit_cost_usd: number | string;
  created_at: string;
}

const PERIODS: { key: Period; label: string }[] = [
  { key: "month", label: "Este mes" },
  { key: "lastMonth", label: "Mes anterior" },
  { key: "days30", label: "Últimos 30 días" },
  { key: "year", label: "Este año" },
];

const TABS: { key: Tab; label: string }[] = [
  { key: "resultados", label: "Resultados" },
  { key: "ventas", label: "Ventas" },
  { key: "finanzas", label: "Finanzas" },
];

function rangeFor(period: Period): { start: Date; end: Date; prevStart: Date } {
  const now = new Date();
  const end = new Date(now);
  let start: Date;
  let prevStart: Date;

  if (period === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  } else if (period === "lastMonth") {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return {
      start,
      end: new Date(now.getFullYear(), now.getMonth(), 1),
      prevStart,
    };
  } else if (period === "days30") {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    prevStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
    prevStart = new Date(now.getFullYear() - 1, 0, 1);
  }

  return { start, end, prevStart };
}

export default function InformesPage() {
  const { accountId } = useAuth();
  const { rate } = usePosRate();

  const [period, setPeriod] = useState<Period>("month");
  const [tab, setTab] = useState<Tab>("resultados");
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [prevSales, setPrevSales] = useState<SaleRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [prevReturns, setPrevReturns] = useState<ReturnRow[]>([]);
  const [yearReturns, setYearReturns] = useState<ReturnRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [prevTxs, setPrevTxs] = useState<TxRow[]>([]);
  const [losses, setLosses] = useState<LossRow[]>([]);
  const [yearSales, setYearSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);

    const { start, end, prevStart } = rangeFor(period);
    const yearStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth() - 11,
      1,
    );

    const [
      salesRes,
      prevSalesRes,
      txRes,
      prevTxRes,
      lossRes,
      yearRes,
      returnsRes,
      prevReturnsRes,
      yearReturnsRes,
    ] = await Promise.all([
        supabase
          .from("pos_sales")
          .select(
            "subtotal_usd, unit_cost_usd, total_usd, balance_usd, status, created_at",
          )
          .eq("account_id", accountId)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString())
          .neq("status", "void"),
        supabase
          .from("pos_sales")
          .select(
            "subtotal_usd, unit_cost_usd, total_usd, balance_usd, status, created_at",
          )
          .eq("account_id", accountId)
          .gte("created_at", prevStart.toISOString())
          .lt("created_at", start.toISOString())
          .neq("status", "void"),
        supabase
          .from("pos_transactions")
          .select("category, kind, amount_usd, description, created_at")
          .eq("account_id", accountId)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString()),
        supabase
          .from("pos_transactions")
          .select("category, kind, amount_usd, description, created_at")
          .eq("account_id", accountId)
          .gte("created_at", prevStart.toISOString())
          .lt("created_at", start.toISOString()),
        supabase
          .from("pos_inventory_movements")
          .select("quantity, unit_cost_usd, created_at")
          .eq("account_id", accountId)
          .eq("kind", "loss")
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString()),
        supabase
          .from("pos_sales")
          .select("subtotal_usd, created_at")
          .eq("account_id", accountId)
          .gte("created_at", yearStart.toISOString())
          .neq("status", "void"),
        supabase
          .from("pos_sale_returns")
          .select("subtotal_usd, cost_usd")
          .eq("account_id", accountId)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString()),
        supabase
          .from("pos_sale_returns")
          .select("subtotal_usd, cost_usd")
          .eq("account_id", accountId)
          .gte("created_at", prevStart.toISOString())
          .lt("created_at", start.toISOString()),
        supabase
          .from("pos_sale_returns")
          .select("subtotal_usd, created_at")
          .eq("account_id", accountId)
          .gte("created_at", yearStart.toISOString()),
      ]);

    setSales((salesRes.data ?? []) as SaleRow[]);
    setPrevSales((prevSalesRes.data ?? []) as SaleRow[]);
    setTxs((txRes.data ?? []) as TxRow[]);
    setPrevTxs((prevTxRes.data ?? []) as TxRow[]);
    setLosses((lossRes.data ?? []) as LossRow[]);
    setYearSales((yearRes.data ?? []) as SaleRow[]);
    setReturns((returnsRes.data ?? []) as ReturnRow[]);
    setPrevReturns((prevReturnsRes.data ?? []) as ReturnRow[]);
    setYearReturns((yearReturnsRes.data ?? []) as ReturnRow[]);
    setLoading(false);
  }, [accountId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(
    () => compute(sales, txs, losses, returns),
    [sales, txs, losses, returns],
  );
  const prevStats = useMemo(
    () => compute(prevSales, prevTxs, [], prevReturns),
    [prevSales, prevTxs, prevReturns],
  );

  const monthly = useMemo(() => {
    const months: { key: string; label: string; value: number }[] = [];
    const now = new Date();
    for (let index = 11; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      months.push({
        key: `${date.getFullYear()}-${date.getMonth()}`,
        label: new Intl.DateTimeFormat("es-VE", { month: "short" }).format(date),
        value: 0,
      });
    }
    const byKey = new Map(months.map((month) => [month.key, month]));
    for (const sale of yearSales) {
      const date = new Date(sale.created_at);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.value += toNumber(sale.subtotal_usd);
    }
    for (const row of yearReturns) {
      if (!row.created_at) continue;
      const date = new Date(row.created_at);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.value -= toNumber(row.subtotal_usd);
    }
    return months;
  }, [yearSales, yearReturns]);

  const maxMonth = Math.max(...monthly.map((month) => month.value), 0.01);

  return (
    <div>
      <PosPageHeader
        title="Informes"
        subtitle="Cómo se compone el resultado de tu negocio."
        actions={
          <div className="flex rounded-xl border border-slate-200 bg-white p-1">
            {PERIODS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setPeriod(item.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  period === item.key
                    ? "bg-indigo-50 text-[#3f3fd8]"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-lg px-3 py-2 text-xs font-bold ${
              tab === item.key
                ? "bg-indigo-50 text-[#3f3fd8]"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
        </div>
      ) : tab === "resultados" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card
              label="Ventas netas"
              value={stats.net}
              rate={rate}
              change={change(stats.net, prevStats.net)}
            />
            <Card
              label="Gastos"
              value={stats.expenses}
              rate={rate}
              change={change(stats.expenses, prevStats.expenses)}
            />
            <Card
              label="Utilidad neta"
              value={stats.netProfit}
              rate={rate}
              change={change(stats.netProfit, prevStats.netProfit)}
              highlight
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-bold text-slate-800">
              Resultados por mes
            </p>
            <p className="text-xs text-slate-500">
              Últimos 12 meses · independiente del período elegido
            </p>
            <div className="mt-4 flex h-40 items-end gap-1.5">
              {monthly.map((month) => (
                <div
                  key={month.key}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                  title={`${month.label}: ${formatUsd(month.value)}`}
                >
                  <div
                    className={`w-full rounded-t ${
                      month.value > 0 ? "bg-[#3f3fd8]" : "bg-slate-200"
                    }`}
                    style={{
                      height:
                        month.value > 0
                          ? `${Math.max((month.value / maxMonth) * 100, 4)}%`
                          : "2px",
                    }}
                  />
                  <span className="text-[9px] uppercase text-slate-400">
                    {month.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-bold text-slate-800">
              De las ventas a tu utilidad
            </p>
            <p className="text-xs text-slate-500">
              Cómo se compone el resultado del período.
            </p>
            <div className="mt-4 divide-y divide-slate-100 text-sm">
              <CascadeRow label="Ventas netas" value={stats.net} rate={rate} />
              <CascadeRow
                label="Costo de lo vendido"
                value={-stats.cogs}
                rate={rate}
              />
              <CascadeRow label="Utilidad bruta" value={stats.gross} rate={rate} bold />
              <CascadeRow label="Gastos" value={-stats.expenses} rate={rate} />
              <CascadeRow label="Comisiones" value={0} rate={rate} />
              <CascadeRow
                label="Pérdidas de inventario"
                value={-stats.losses}
                rate={rate}
              />
              <CascadeRow
                label="Utilidad neta"
                value={stats.netProfit}
                rate={rate}
                bold
              />
            </div>
          </div>
        </div>
      ) : null}

      {!loading && tab === "ventas" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Mini label="Vendido" value={formatUsd(stats.net)} hint={formatBs(usdToBs(stats.net, rate))} />
            <Mini label="Ventas" value={String(stats.count)} hint="Sin anuladas" />
            <Mini
              label="Ticket promedio"
              value={formatUsd(stats.avg)}
              hint={formatBs(usdToBs(stats.avg, rate))}
            />
            <Mini
              label="A crédito"
              value={formatUsd(stats.credit)}
              hint={`${stats.credit > 0 ? "Saldo pendiente" : "Ninguno"}`}
            />
          </div>
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
            Para el detalle venta por venta, abre <strong>POS → Ventas → Historial</strong>.
          </p>
        </div>
      ) : null}

      {!loading && tab === "finanzas" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Mini
              label="Ingresos cobrados"
              value={formatUsd(stats.income)}
              hint={formatBs(usdToBs(stats.income, rate))}
            />
            <Mini
              label="Gastos pagados"
              value={formatUsd(stats.expenses)}
              hint={formatBs(usdToBs(stats.expenses, rate))}
            />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-bold text-slate-800">Gastos por categoría</p>
            {stats.expensesByCategory.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                No hay gastos registrados en el período.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {stats.expensesByCategory.map(([category, value]) => (
                  <li
                    key={category}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="capitalize text-slate-600">{category}</span>
                    <span className="font-semibold text-slate-900">
                      {formatUsd(value)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function compute(
  sales: SaleRow[],
  txs: TxRow[],
  losses: LossRow[],
  returns: ReturnRow[] = [],
) {
  const soldNet = sales.reduce(
    (sum, sale) => sum + toNumber(sale.subtotal_usd),
    0,
  );
  const soldCost = sales.reduce(
    (sum, sale) => sum + toNumber(sale.unit_cost_usd),
    0,
  );
  const returnedNet = returns.reduce(
    (sum, row) => sum + toNumber(row.subtotal_usd),
    0,
  );
  const returnedCost = returns.reduce(
    (sum, row) => sum + toNumber(row.cost_usd),
    0,
  );
  const net = soldNet - returnedNet;
  const cogs = soldCost - returnedCost;
  const credit = sales.reduce(
    (sum, sale) => sum + toNumber(sale.balance_usd),
    0,
  );
  const count = sales.length;

  const expenses = txs
    .filter((tx) => tx.category === "expense" && tx.kind === "out")
    .reduce((sum, tx) => sum + toNumber(tx.amount_usd), 0);

  const income = txs
    .filter((tx) => tx.kind === "in")
    .reduce((sum, tx) => sum + toNumber(tx.amount_usd), 0);

  const byCategory = new Map<string, number>();
  for (const tx of txs) {
    if (tx.category !== "expense" || tx.kind !== "out") continue;
    const label = tx.description?.split(" · ")[1]?.trim() || "general";
    byCategory.set(label, (byCategory.get(label) ?? 0) + toNumber(tx.amount_usd));
  }

  const lossTotal = losses.reduce(
    (sum, loss) =>
      sum + Math.abs(toNumber(loss.quantity)) * toNumber(loss.unit_cost_usd),
    0,
  );

  const gross = net - cogs;

  return {
    net,
    cogs,
    credit,
    count,
    avg: count > 0 ? net / count : 0,
    expenses,
    income,
    losses: lossTotal,
    gross,
    netProfit: gross - expenses - lossTotal,
    expensesByCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function change(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function Card({
  label,
  value,
  rate,
  change,
  highlight,
}: {
  label: string;
  value: number;
  rate: number;
  change: number | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight
          ? "border-indigo-200 bg-indigo-50/60"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black text-slate-900">
        {formatUsd(value)}
      </p>
      <p className="text-[11px] text-slate-500">{formatBs(usdToBs(value, rate))}</p>
      {change != null ? (
        <p
          className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${
            change >= 0 ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {change >= 0 ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {change >= 0 ? "+" : ""}
          {change.toFixed(1)}% vs. período anterior
        </p>
      ) : null}
    </div>
  );
}

function CascadeRow({
  label,
  value,
  rate,
  bold,
}: {
  label: string;
  value: number;
  rate: number;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className={bold ? "font-bold text-slate-800" : "text-slate-600"}>
        {label}
      </span>
      <span className="text-right">
        <span
          className={`block font-semibold ${
            value < 0 ? "text-red-600" : "text-slate-900"
          }`}
        >
          {formatUsd(value)}
        </span>
        <span className="block text-[10px] text-slate-400">
          {formatBs(usdToBs(value, rate))}
        </span>
      </span>
    </div>
  );
}

function Mini({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-black text-slate-900">{value}</p>
      {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}
