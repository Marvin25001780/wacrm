"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Receipt, Search, ShoppingCart } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import { PosButton, PosPageHeader } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, toNumber } from "@/lib/pos/money";

interface SaleRow {
  id: string;
  number: number;
  status: "paid" | "credit" | "void";
  subtotal_usd: number | string;
  tax_iva_usd: number | string;
  tax_igtf_usd: number | string;
  total_usd: number | string;
  balance_usd: number | string;
  created_at: string;
}

const STATUS_LABEL: Record<SaleRow["status"], string> = {
  paid: "Pagada",
  credit: "A crédito",
  void: "Anulada",
};

export default function HistorialPage() {
  const { accountId } = useAuth();
  const { rate } = usePosRate();
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);
    const { data } = await supabase
      .from("pos_sales")
      .select(
        "id, number, status, subtotal_usd, tax_iva_usd, tax_igtf_usd, total_usd, balance_usd, created_at",
      )
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(200);
    setSales((data ?? []) as SaleRow[]);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const valid = sales.filter((sale) => sale.status !== "void");
    const sold = valid.reduce((sum, sale) => sum + toNumber(sale.subtotal_usd), 0);
    const credit = valid.reduce((sum, sale) => sum + toNumber(sale.balance_usd), 0);
    return {
      sold,
      count: valid.length,
      credit,
      avg: valid.length > 0 ? sold / valid.length : 0,
    };
  }, [sales]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sales;
    return sales.filter(
      (sale) =>
        String(sale.number).includes(term) ||
        STATUS_LABEL[sale.status].toLowerCase().includes(term),
    );
  }, [sales, search]);

  return (
    <div>
      <PosPageHeader
        title="Historial de ventas"
        subtitle="Lo vendido, sus cobros y devoluciones."
        actions={
          <Link href="/pos/vender">
            <PosButton>
              <Plus className="h-4 w-4" />
              Nueva venta
            </PosButton>
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Vendido"
          usd={stats.sold}
          hint={`${formatBs(stats.sold * rate)}`}
        />
        <StatCard
          label="Ventas"
          value={String(stats.count)}
          hint="Sin contar anuladas"
        />
        <StatCard
          label="Ticket promedio"
          usd={stats.avg}
          hint={stats.count === 0 ? "Todavía no hay ventas" : undefined}
        />
        <StatCard
          label="Vendido a crédito"
          usd={stats.credit}
          hint={stats.credit > 0 ? "Saldo pendiente" : "Ninguna venta a crédito"}
        />
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por n.º de venta o estado"
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
          <ShoppingCart className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-bold text-slate-800">
            Aún no hay ventas
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Las ventas que cobres en el POS aparecen aquí al instante.
          </p>
          <Link href="/pos/vender" className="mt-5 inline-block">
            <PosButton>Ir al POS</PosButton>
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Venta</th>
                <th className="px-4 py-2.5 font-semibold">Fecha</th>
                <th className="px-4 py-2.5 font-semibold">Estado</th>
                <th className="px-4 py-2.5 text-right font-semibold">IVA</th>
                <th className="px-4 py-2.5 text-right font-semibold">IGTF</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                <th className="px-4 py-2.5 text-right font-semibold">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((sale) => (
                <tr key={sale.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                      <Receipt className="h-3.5 w-3.5 text-slate-400" />
                      #{sale.number}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Intl.DateTimeFormat("es-VE", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(sale.created_at))}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={sale.status} />
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    {formatUsd(toNumber(sale.tax_iva_usd))}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    {formatUsd(toNumber(sale.tax_igtf_usd))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">
                    {formatUsd(toNumber(sale.total_usd))}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {toNumber(sale.balance_usd) > 0.005
                      ? formatUsd(toNumber(sale.balance_usd))
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  usd,
  value,
  hint,
}: {
  label: string;
  usd?: number;
  value?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-100/70 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">
        {value ?? formatUsd(usd ?? 0)}
      </p>
      {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function StatusPill({ status }: { status: SaleRow["status"] }) {
  const styles =
    status === "paid"
      ? "bg-emerald-50 text-emerald-700"
      : status === "credit"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-500";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
