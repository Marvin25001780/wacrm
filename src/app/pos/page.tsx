"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Plus,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import { usePosShift } from "@/components/pos/shift-context";
import { DailyCloseDialog } from "@/components/pos/daily-close-dialog";
import { PosButton, PosPageHeader } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import {
  PAYMENT_METHODS,
  formatBs,
  formatUsd,
  round2,
  toNumber,
  usdToBs,
} from "@/lib/pos/money";

interface SaleRow {
  id: string;
  number: number;
  subtotal_usd: number | string;
  unit_cost_usd: number | string;
  total_usd: number | string;
  balance_usd: number | string;
  status: string;
  created_at: string;
}

interface PaymentRow {
  sale_id: string;
  method: string;
  amount_usd: number | string;
  igtf_usd: number | string;
}

interface ProductRow {
  id: string;
  name: string;
  stock: number | string;
  min_stock: number | string;
  unit: string;
}

const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((method) => [method.value, method.label]),
);

const METHOD_COLOR: Record<string, string> = {
  cash_usd: "bg-[#4338ca]",
  zelle: "bg-emerald-500",
  cash_bs: "bg-amber-400",
  pago_movil: "bg-sky-500",
  transfer_bs: "bg-violet-400",
  card: "bg-rose-400",
  other: "bg-slate-400",
};

export default function PosHomePage() {
  const { accountId, account, user } = useAuth();
  const { rate } = usePosRate();
  const { shift, missing: shiftMissing } = usePosShift();

  const [today, setToday] = useState<SaleRow[]>([]);
  const [yesterday, setYesterday] = useState<SaleRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [returnsToday, setReturnsToday] = useState<
    { subtotal_usd: number | string; cost_usd: number | string }[]
  >([]);
  const [returnsYesterday, setReturnsYesterday] = useState<
    { subtotal_usd: number | string; cost_usd: number | string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [closeOpen, setCloseOpen] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);

    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startYesterday = new Date(startToday);
    startYesterday.setDate(startYesterday.getDate() - 1);

    const [todayRes, yesterdayRes, productsRes, returnsTodayRes, returnsYesterdayRes] =
      await Promise.all([
        supabase
          .from("pos_sales")
          .select(
            "id, number, subtotal_usd, unit_cost_usd, total_usd, balance_usd, status, created_at",
          )
          .eq("account_id", accountId)
          .gte("created_at", startToday.toISOString())
          .order("created_at", { ascending: false }),
        supabase
          .from("pos_sales")
          .select(
            "id, number, subtotal_usd, unit_cost_usd, total_usd, balance_usd, status, created_at",
          )
          .eq("account_id", accountId)
          .gte("created_at", startYesterday.toISOString())
          .lt("created_at", startToday.toISOString()),
        supabase
          .from("pos_products")
          .select("id, name, stock, min_stock, unit")
          .eq("account_id", accountId)
          .eq("active", true)
          .eq("kind", "product")
          .order("stock", { ascending: true })
          .limit(40),
        supabase
          .from("pos_sale_returns")
          .select("subtotal_usd, cost_usd")
          .eq("account_id", accountId)
          .gte("created_at", startToday.toISOString()),
        supabase
          .from("pos_sale_returns")
          .select("subtotal_usd, cost_usd")
          .eq("account_id", accountId)
          .gte("created_at", startYesterday.toISOString())
          .lt("created_at", startToday.toISOString()),
      ]);

    const todayRows = (todayRes.data ?? []) as SaleRow[];
    setToday(todayRows);
    setYesterday((yesterdayRes.data ?? []) as SaleRow[]);
    setProducts((productsRes.data ?? []) as ProductRow[]);
    setReturnsToday(
      (returnsTodayRes.data ?? []) as {
        subtotal_usd: number | string;
        cost_usd: number | string;
      }[],
    );
    setReturnsYesterday(
      (returnsYesterdayRes.data ?? []) as {
        subtotal_usd: number | string;
        cost_usd: number | string;
      }[],
    );

    if (todayRows.length > 0) {
      const { data: paymentData } = await supabase
        .from("pos_sale_payments")
        .select("sale_id, method, amount_usd, igtf_usd")
        .in(
          "sale_id",
          todayRows.map((sale) => sale.id),
        );
      setPayments((paymentData ?? []) as PaymentRow[]);
    } else {
      setPayments([]);
    }

    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(
    () => withReturns(metrics(today), returnsToday),
    [today, returnsToday],
  );
  const prevStats = useMemo(
    () => withReturns(metrics(yesterday), returnsYesterday),
    [yesterday, returnsYesterday],
  );

  const hourly = useMemo(() => {
    const buckets = new Array(13).fill(0) as number[];
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Caracas",
    });
    for (const sale of today) {
      const hour = Number(formatter.format(new Date(sale.created_at)));
      const index = hour - 8;
      if (index >= 0 && index < buckets.length) {
        buckets[index] += toNumber(sale.subtotal_usd);
      }
    }
    return buckets;
  }, [today]);

  const maxHour = Math.max(...hourly, 0.01);
  const peakIndex = hourly.indexOf(Math.max(...hourly));

  const methods = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of payments) {
      const value = toNumber(payment.amount_usd) + toNumber(payment.igtf_usd);
      map.set(payment.method, (map.get(payment.method) ?? 0) + value);
    }
    const total = [...map.values()].reduce((sum, value) => sum + value, 0);
    return {
      total,
      rows: [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([method, value]) => ({
          method,
          label: METHOD_LABEL[method] ?? method,
          color: METHOD_COLOR[method] ?? "bg-slate-400",
          value,
          percent: total > 0 ? (value / total) * 100 : 0,
        })),
    };
  }, [payments]);

  const lowStock = useMemo(
    () =>
      products
        .filter(
          (product) =>
            toNumber(product.stock) <= Math.max(toNumber(product.min_stock), 3),
        )
        .slice(0, 5),
    [products],
  );

  const methodBySale = useMemo(() => {
    const map = new Map<string, string>();
    for (const payment of payments) {
      if (!map.has(payment.sale_id)) {
        map.set(payment.sale_id, METHOD_LABEL[payment.method] ?? payment.method);
      }
    }
    return map;
  }, [payments]);

  const firstName = (user?.email ?? "").split("@")[0] || "equipo";
  const dateLabel = new Intl.DateTimeFormat("es-VE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="space-y-5">
      {/* Bienvenida */}
      <section className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">
              ¡Hola, {firstName}!
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                shiftMissing
                  ? "bg-slate-100 text-slate-600"
                  : shift
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  shiftMissing
                    ? "bg-slate-400"
                    : shift
                      ? "bg-emerald-500"
                      : "bg-amber-500"
                }`}
              />
              {shiftMissing
                ? "POS activo"
                : shift
                  ? `Turno #${shift.number} abierto`
                  : "Caja cerrada"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Resumen de <strong className="text-slate-700">{account?.name}</strong>{" "}
            · {dateLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!shiftMissing ? (
            <Link href="/pos/turnos">
              <PosButton variant="outline">
                <Receipt className="h-4 w-4" />
                {shift ? "Arqueo de caja" : "Abrir turno"}
              </PosButton>
            </Link>
          ) : null}
          <PosButton variant="outline" onClick={() => setCloseOpen(true)}>
            <Receipt className="h-4 w-4" />
            Resumen del día
          </PosButton>
          <Link href="/pos/vender">
            <PosButton className="px-5 py-2.5">
              <Plus className="h-4 w-4" />
              Nueva venta
            </PosButton>
          </Link>
        </div>
      </section>

      {/* KPIs */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Ventas de hoy"
          value={stats.net}
          rate={rate}
          change={change(stats.net, prevStats.net)}
          icon={<Wallet className="h-5 w-5" />}
          spark={hourly}
        />
        <KpiCard
          label="Ticket promedio"
          value={stats.avg}
          rate={rate}
          change={change(stats.avg, prevStats.avg)}
          icon={<Receipt className="h-5 w-5" />}
          spark={hourly}
        />
        <KpiCard
          label="Transacciones"
          value={stats.count}
          money={false}
          change={change(stats.count, prevStats.count)}
          icon={<CheckCircle2 className="h-5 w-5" />}
          hint={
            stats.count > 0
              ? `Ritmo: ~${(stats.count / Math.max(1, currentHour() - 8)).toFixed(1)} tickets/hora`
              : "Sin ventas todavía"
          }
        />
        <KpiCard
          label="Utilidad neta"
          value={stats.profit}
          rate={rate}
          change={change(stats.profit, prevStats.profit)}
          icon={<TrendingUp className="h-5 w-5" />}
          hint={
            stats.net > 0
              ? `Margen: ${((stats.profit / stats.net) * 100).toFixed(1)}%`
              : undefined
          }
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-10">
        {/* Columna izquierda */}
        <div className="space-y-4 xl:col-span-7">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Curva de ventas
                </h2>
                <p className="text-xs text-slate-500">
                  Distribución por hora, de 8:00 a 20:00
                </p>
              </div>
              {stats.count > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                  <span className="h-2 w-2 rounded-full bg-[#4338ca]" />
                  Pico: {peakIndex + 8}:00
                </span>
              ) : null}
            </div>

            <div className="relative mt-5">
              {stats.count === 0 ? (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                  Todavía no hay ventas hoy. Aquí las verás entrar, hora por
                  hora.
                </p>
              ) : null}
              <div className="flex h-52 items-end gap-2 px-1">
                {hourly.map((value, index) => {
                  const isPeak = value > 0 && index === peakIndex;
                  return (
                    <div
                      key={index}
                      className="group flex h-full flex-1 flex-col items-center justify-end gap-2"
                      title={`${index + 8}:00 · ${formatUsd(value)}`}
                    >
                      <div
                        className={`w-full max-w-8 rounded-t-lg transition-colors ${
                          isPeak
                            ? "bg-[#4338ca]"
                            : value > 0
                              ? "bg-indigo-200 group-hover:bg-indigo-300"
                              : "bg-slate-100"
                        }`}
                        style={{
                          height:
                            value > 0
                              ? `${Math.max((value / maxHour) * 100, 5)}%`
                              : "3px",
                        }}
                      />
                      <span
                        className={`text-[10px] ${
                          isPeak
                            ? "font-bold text-[#4338ca]"
                            : "text-slate-400"
                        }`}
                      >
                        {String(index + 8).padStart(2, "0")}h
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Métodos de pago
                </h2>
                <p className="text-xs text-slate-500">
                  Distribución sobre el volumen cobrado hoy
                </p>
              </div>
              {rate > 0 ? (
                <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                  Tasa: {formatBs(rate)}
                </span>
              ) : null}
            </div>

            {methods.total === 0 ? (
              <p className="mt-6 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                Aún no hay cobros registrados hoy.
              </p>
            ) : (
              <>
                <div className="mt-4 flex h-3 overflow-hidden rounded-full">
                  {methods.rows.map((row) => (
                    <div
                      key={row.method}
                      className={row.color}
                      style={{ width: `${row.percent}%` }}
                      title={`${row.label}: ${row.percent.toFixed(0)}%`}
                    />
                  ))}
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {methods.rows.slice(0, 6).map((row) => (
                    <div
                      key={row.method}
                      className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-700">
                          {row.label}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {formatUsd(row.value)}
                        </p>
                      </div>
                      <span className="ml-2 text-sm font-black text-slate-900">
                        {row.percent.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {/* Columna derecha */}
        <div className="space-y-4 xl:col-span-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Alertas del día
              </h2>
              {lowStock.length > 0 ? (
                <span className="h-2 w-2 animate-ping rounded-full bg-red-500" />
              ) : null}
            </div>

            {lowStock.length === 0 ? (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                Sin productos con stock bajo.
              </p>
            ) : (
              <div className="mt-3 space-y-1.5">
                {lowStock.map((product) => {
                  const stock = toNumber(product.stock);
                  return (
                    <div
                      key={product.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-red-50/60 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-xs font-medium text-slate-700">
                        {product.name}
                      </span>
                      <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                        {stock <= 0 ? "Agotado" : `${stock} ${product.unit}`}
                      </span>
                    </div>
                  );
                })}
                <Link
                  href="/pos/inventario"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#4338ca] hover:underline"
                >
                  Ver inventario <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800">Últimas ventas</h2>
              <Link
                href="/pos/ventas"
                className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#4338ca] hover:underline"
              >
                Ver todas
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>

            {today.length === 0 ? (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
                Aún no hay ventas hoy.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {today.slice(0, 4).map((sale) => (
                  <div
                    key={sale.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-700">
                          Ticket #{sale.number}
                        </p>
                        <p className="truncate text-[10px] text-slate-400">
                          {formatTime(sale.created_at)}
                          {methodBySale.get(sale.id)
                            ? ` · ${methodBySale.get(sale.id)}`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-bold text-slate-900">
                        {formatUsd(toNumber(sale.total_usd))}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {formatBs(usdToBs(toNumber(sale.total_usd), rate))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <DailyCloseDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        accountId={accountId}
        accountName={account?.name ?? ""}
        rate={rate}
      />

      {loading ? (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-[#4338ca]" />
        </div>
      ) : null}
    </div>
  );
}

function metrics(sales: SaleRow[]) {
  const valid = sales.filter((sale) => sale.status !== "void");
  const net = valid.reduce((sum, sale) => sum + toNumber(sale.subtotal_usd), 0);
  const cost = valid.reduce(
    (sum, sale) => sum + toNumber(sale.unit_cost_usd),
    0,
  );
  const count = valid.length;
  return {
    count,
    net,
    profit: net - cost,
    avg: count > 0 ? net / count : 0,
  };
}

function withReturns(
  base: ReturnType<typeof metrics>,
  returns: { subtotal_usd: number | string; cost_usd: number | string }[],
) {
  const returnedNet = returns.reduce(
    (sum, row) => sum + toNumber(row.subtotal_usd),
    0,
  );
  const returnedCost = returns.reduce(
    (sum, row) => sum + toNumber(row.cost_usd),
    0,
  );
  const net = round2(base.net - returnedNet);
  return {
    ...base,
    net,
    profit: round2(base.profit - (returnedNet - returnedCost)),
    avg: base.count > 0 ? net / base.count : 0,
  };
}

function change(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function currentHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Caracas",
    }).format(new Date()),
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("es-VE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Caracas",
  }).format(new Date(value));
}

function KpiCard({
  label,
  value,
  rate,
  money = true,
  change,
  icon,
  hint,
  spark,
}: {
  label: string;
  value: number;
  rate?: number;
  money?: boolean;
  change: number | null;
  icon: React.ReactNode;
  hint?: string;
  spark?: number[];
}) {
  const positive = (change ?? 0) >= 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {label}
          </p>
          <p className="mt-1 text-3xl font-black tracking-tight text-slate-900">
            {money ? formatUsd(value) : value}
          </p>
          <p className="text-[11px] text-slate-500">
            {money
              ? formatBs(usdToBs(value, rate ?? 0))
              : hint ?? "\u00A0"}
          </p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-[#4338ca]">
          {icon}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {change != null ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              positive
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-600"
            }`}
          >
            {positive ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {positive ? "+" : ""}
            {change.toFixed(1)}% vs ayer
          </span>
        ) : (
          <span className="text-[10px] text-slate-400">Sin comparación</span>
        )}
        {spark ? <Sparkline values={spark} /> : null}
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const width = 84;
  const height = 26;
  const max = Math.max(...values, 0.01);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - 2 - (value / max) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="h-6 w-20 text-[#4338ca]" viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
