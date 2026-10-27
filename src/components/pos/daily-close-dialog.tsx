"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Loader2, MessageCircle, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  PAYMENT_METHODS,
  formatBs,
  formatUsd,
  toNumber,
  usdToBs,
} from "@/lib/pos/money";

interface SaleRow {
  id: string;
  subtotal_usd: number | string;
  unit_cost_usd: number | string;
  balance_usd: number | string;
  status: string;
}

interface PaymentRow {
  method: string;
  amount_usd: number | string;
  igtf_usd: number | string;
}

const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((method) => [method.value, method.label]),
);

export function DailyCloseDialog({
  open,
  onOpenChange,
  accountName,
  rate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountName: string;
  rate: number;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!open) return;
    const supabase = createClient();
    setLoading(true);

    // Día local de Venezuela (UTC-4) para no cortar ventas de la noche.
    const start = new Date(`${date}T00:00:00-04:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const { data: salesData } = await supabase
      .from("pos_sales")
      .select("id, subtotal_usd, unit_cost_usd, balance_usd, status")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .neq("status", "void");

    const rows = (salesData ?? []) as SaleRow[];
    setSales(rows);

    if (rows.length === 0) {
      setPayments([]);
      setLoading(false);
      return;
    }

    const { data: paymentsData } = await supabase
      .from("pos_sale_payments")
      .select("method, amount_usd, igtf_usd")
      .in(
        "sale_id",
        rows.map((sale) => sale.id),
      );

    setPayments((paymentsData ?? []) as PaymentRow[]);
    setLoading(false);
  }, [open, date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (open) {
      setDate(new Date().toISOString().slice(0, 10));
      setCopied(false);
    }
  }, [open]);

  const summary = useMemo(() => {
    const net = sales.reduce((sum, sale) => sum + toNumber(sale.subtotal_usd), 0);
    const cost = sales.reduce(
      (sum, sale) => sum + toNumber(sale.unit_cost_usd),
      0,
    );
    const credit = sales.reduce(
      (sum, sale) => sum + toNumber(sale.balance_usd),
      0,
    );
    const count = sales.length;

    const byMethod = new Map<string, number>();
    for (const payment of payments) {
      const value =
        toNumber(payment.amount_usd) + toNumber(payment.igtf_usd);
      byMethod.set(
        payment.method,
        (byMethod.get(payment.method) ?? 0) + value,
      );
    }

    return {
      net,
      cost,
      credit,
      count,
      avg: count > 0 ? net / count : 0,
      gross: net - cost,
      byMethod: [...byMethod.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [sales, payments]);

  const text = useMemo(() => {
    const lines = [
      `*Cierre del día · ${accountName || "Mi negocio"}*`,
      date,
      `Ventas netas (${summary.count}): ${formatUsd(summary.net)} (${formatBs(usdToBs(summary.net, rate))})`,
      `Ticket promedio: ${formatUsd(summary.avg)} (${formatBs(usdToBs(summary.avg, rate))})`,
      "Cobros por cuenta:",
    ];

    if (summary.byMethod.length === 0) {
      lines.push("• Sin cobros registrados");
    } else {
      for (const [method, value] of summary.byMethod) {
        lines.push(
          `• ${METHOD_LABEL[method] ?? method}: ${formatUsd(value)} (${formatBs(usdToBs(value, rate))})`,
        );
      }
    }

    lines.push(
      `Ventas a crédito: ${formatUsd(summary.credit)} (${formatBs(usdToBs(summary.credit, rate))})`,
      `Gastos pagados: ${formatUsd(0)} (${formatBs(0)})`,
      `Utilidad bruta: ${formatUsd(summary.gross)} (${formatBs(usdToBs(summary.gross, rate))})`,
      "Turnos con diferencia:",
      "• Ninguno",
    );

    return lines.join("\n");
  }, [accountName, date, rate, summary]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-900">Cierre del día</h2>
            <p className="text-xs text-slate-500">
              Resumen de la operación para compartir.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Fecha
            </span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
            />
          </label>

          <div className="relative mt-3">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70">
                <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
              </div>
            ) : null}
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-100 px-4 py-3 font-mono text-xs leading-relaxed text-slate-700">
              {text}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Copy className="h-4 w-4" />
            {copied ? "Copiado" : "Copiar"}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-[#3f3fd8] px-4 py-2 text-sm font-bold text-white hover:bg-[#3535c4]"
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
