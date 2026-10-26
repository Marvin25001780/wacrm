"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, Plus, Receipt } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import {
  PosButton,
  PosMetric,
  PosPageHeader,
} from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, toNumber } from "@/lib/pos/money";

interface SaleRow {
  id: string;
  number: number;
  subtotal_usd: number | string;
  tax_iva_usd: number | string;
  tax_igtf_usd: number | string;
  total_usd: number | string;
  paid_usd: number | string;
  balance_usd: number | string;
  unit_cost_usd: number | string;
  status: string;
  created_at: string;
}

export default function PosHomePage() {
  const { accountId, account, user } = useAuth();
  const { rate } = usePosRate();
  const [today, setToday] = useState<SaleRow[]>([]);
  const [month, setMonth] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);

    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayRes, monthRes] = await Promise.all([
      supabase
        .from("pos_sales")
        .select(
          "id, number, subtotal_usd, tax_iva_usd, tax_igtf_usd, total_usd, paid_usd, balance_usd, unit_cost_usd, status, created_at",
        )
        .eq("account_id", accountId)
        .gte("created_at", startToday.toISOString())
        .order("created_at", { ascending: false }),
      supabase
        .from("pos_sales")
        .select(
          "id, number, subtotal_usd, tax_iva_usd, tax_igtf_usd, total_usd, paid_usd, balance_usd, unit_cost_usd, status, created_at",
        )
        .eq("account_id", accountId)
        .gte("created_at", startMonth.toISOString()),
    ]);

    setToday((todayRes.data ?? []) as SaleRow[]);
    setMonth((monthRes.data ?? []) as SaleRow[]);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const todayStats = useMemo(() => metrics(today), [today]);
  const monthStats = useMemo(() => metrics(month), [month]);

  const pending = useMemo(
    () =>
      month.filter(
        (sale) =>
          sale.status === "credit" && toNumber(sale.balance_usd) > 0.005,
      ),
    [month],
  );

  const firstName = (user?.email ?? "").split("@")[0] || "equipo";
  const dateLabel = new Intl.DateTimeFormat("es-VE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="space-y-4">
      <PosPageHeader
        title={`Hola, ${firstName}`}
        subtitle={`Así va ${account?.name ?? "tu negocio"} · ${dateLabel}`}
        actions={
          <>
            <PosButton variant="outline">
              <Receipt className="h-4 w-4" />
              Cierre del día
            </PosButton>
            <Link href="/pos/vender">
              <PosButton>
                <Plus className="h-4 w-4" />
                Vender
              </PosButton>
            </Link>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">Hoy</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-4xl font-black tracking-tight text-slate-900">
                    {formatUsd(todayStats.netSales)}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {formatBs(todayStats.netSales * rate)} · sin IVA
                </p>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                En vivo
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <MiniMetric label="Ventas" value={String(todayStats.count)} />
              <MiniMetric
                label="Ticket promedio"
                value={formatUsd(todayStats.avgTicket)}
                hint={formatBs(todayStats.avgTicket * rate)}
              />
              <MiniMetric
                label="Utilidad neta"
                value={formatUsd(todayStats.profit)}
                hint={formatBs(todayStats.profit * rate)}
              />
            </div>

            <div className="mt-5 rounded-xl border border-indigo-100 bg-white/60 px-4 py-8 text-center">
              {todayStats.count === 0 ? (
                <p className="text-sm text-slate-500">
                  Todavía no hay ventas hoy. Aquí las verás entrar, hora por
                  hora.
                </p>
              ) : (
                <ul className="space-y-2 text-left">
                  {today.slice(0, 4).map((sale) => (
                    <li
                      key={sale.id}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm"
                    >
                      <span className="font-semibold text-slate-700">
                        Venta #{sale.number}
                      </span>
                      <span className="text-slate-500">
                        {formatUsd(toNumber(sale.total_usd))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  {new Intl.DateTimeFormat("es-VE", {
                    month: "long",
                  }).format(new Date())}
                </p>
                <p className="text-xs text-slate-500">
                  {new Intl.DateTimeFormat("es-VE", {
                    day: "numeric",
                    month: "short",
                  }).format(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}{" "}
                  –{" "}
                  {new Intl.DateTimeFormat("es-VE", {
                    day: "numeric",
                    month: "short",
                  }).format(new Date())}
                </p>
              </div>
              <Link
                href="/pos/ventas"
                className="flex items-center gap-1 text-xs font-semibold text-[#3f3fd8] hover:underline"
              >
                Ver historial <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MonthMetric
                label="Ventas netas"
                usd={monthStats.netSales}
                rate={rate}
              />
              <MonthMetric
                label="Ventas"
                value={String(monthStats.count)}
                rate={rate}
              />
              <MonthMetric
                label="Ticket promedio"
                usd={monthStats.avgTicket}
                rate={rate}
              />
              <MonthMetric
                label="Utilidad neta"
                usd={monthStats.profit}
                rate={rate}
              />
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-bold text-slate-800">Por atender</p>
            </div>
            <div className="px-4 py-8 text-center">
              {pending.length === 0 ? (
                <>
                  <CircleCheck className="mx-auto h-7 w-7 text-slate-300" />
                  <p className="mt-2 text-sm font-semibold text-slate-700">
                    Todo al día: no hay nada por atender ahora.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Los avisos aparecerán aquí cuando haya algo que revisar.
                  </p>
                </>
              ) : (
                <ul className="space-y-2 text-left">
                  {pending.slice(0, 6).map((sale) => (
                    <li
                      key={sale.id}
                      className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs"
                    >
                      <span className="font-semibold text-slate-700">
                        Venta #{sale.number}
                      </span>
                      <span className="text-amber-700">
                        {formatUsd(toNumber(sale.balance_usd))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-bold text-slate-800">Atajos</p>
            <div className="mt-3 space-y-2">
              <Link
                href="/pos/vender"
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Nueva venta <Plus className="h-4 w-4 text-slate-400" />
              </Link>
              <Link
                href="/pos/catalogo"
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Crear producto <Plus className="h-4 w-4 text-slate-400" />
              </Link>
            </div>
            {rate <= 0 ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                Configura la tasa del día en la barra superior para ver los
                equivalentes en bolívares.
              </p>
            ) : null}
          </section>
        </aside>
      </div>

      {loading ? (
        <p className="text-center text-xs text-slate-400">Cargando ventas…</p>
      ) : null}
    </div>
  );
}

function metrics(sales: SaleRow[]) {
  const valid = sales.filter((sale) => sale.status !== "void");
  const netSales = valid.reduce(
    (sum, sale) => sum + toNumber(sale.subtotal_usd),
    0,
  );
  const cost = valid.reduce(
    (sum, sale) => sum + toNumber(sale.unit_cost_usd),
    0,
  );
  const count = valid.length;
  return {
    count,
    netSales,
    profit: Math.max(netSales - cost, 0),
    avgTicket: count > 0 ? netSales / count : 0,
  };
}

function MiniMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-indigo-100 bg-white/70 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="text-base font-black text-slate-900">{value}</p>
      {hint ? <p className="text-[10px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

function MonthMetric({
  label,
  usd,
  value,
  rate,
}: {
  label: string;
  usd?: number;
  value?: string;
  rate: number;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="text-lg font-black text-slate-900">
        {value ?? formatUsd(usd ?? 0)}
      </p>
      {value ? null : (
        <p className="text-[10px] text-slate-400">
          {formatBs((usd ?? 0) * rate)}
        </p>
      )}
    </div>
  );
}
