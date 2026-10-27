"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import { createClient } from "@/lib/supabase/client";
import { formatUsd, round2, toNumber } from "@/lib/pos/money";
import { PosButton } from "@/components/pos/pos-shell";

interface SaleRow {
  id: string;
  number: number;
  status: string;
  total_usd: number | string;
  balance_usd: number | string;
  returned_usd: number | string;
  exchange_rate_used: number | string;
}

interface ItemRow {
  id: string;
  name: string;
  quantity: number | string;
  line_total_usd: number | string;
  taxable: boolean;
}

interface AccountRow {
  id: string;
  name: string;
  currency: "USD" | "VES";
}

interface ReturnItemRow {
  sale_item_id: string;
  quantity: number | string;
}

export function SaleReturnDialog({
  saleId,
  open,
  onOpenChange,
  onReturned,
}: {
  saleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturned: () => void;
}) {
  const { accountId } = useAuth();
  const { rate } = usePosRate();
  const [sale, setSale] = useState<SaleRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [returned, setReturned] = useState<Map<string, number>>(new Map());
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [refundAccountId, setRefundAccountId] = useState("");
  const [ivaRate, setIvaRate] = useState(16);
  const [ivaOn, setIvaOn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ number: number; total: number } | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!open || !saleId || !accountId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setQuantities({});
    setReason("");
    setRefundAccountId("");

    const supabase = createClient();
    const [saleRes, itemsRes, accountsRes, settingsRes, returnsRes] =
      await Promise.all([
        supabase.from("pos_sales").select("*").eq("id", saleId).maybeSingle(),
        supabase
          .from("pos_sale_items")
          .select("id, name, quantity, line_total_usd, taxable")
          .eq("sale_id", saleId),
        supabase
          .from("pos_accounts")
          .select("id, name, currency")
          .eq("account_id", accountId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("pos_settings")
          .select("iva_rate, iva_enabled")
          .eq("account_id", accountId)
          .maybeSingle(),
        supabase
          .from("pos_sale_returns")
          .select("id")
          .eq("sale_id", saleId),
      ]);

    if (saleRes.error || !saleRes.data) {
      setError(saleRes.error?.message ?? "No se encontró la venta.");
      setLoading(false);
      return;
    }

    const returnIds = (returnsRes.data ?? []).map(
      (row) => (row as { id: string }).id,
    );
    let previous: ReturnItemRow[] = [];
    if (returnIds.length > 0) {
      const { data } = await supabase
        .from("pos_sale_return_items")
        .select("sale_item_id, quantity")
        .in("return_id", returnIds);
      previous = (data ?? []) as ReturnItemRow[];
    }

    const returnedMap = new Map<string, number>();
    for (const row of previous) {
      returnedMap.set(
        row.sale_item_id,
        round2((returnedMap.get(row.sale_item_id) ?? 0) + toNumber(row.quantity)),
      );
    }

    setSale(saleRes.data as SaleRow);
    setItems((itemsRes.data ?? []) as ItemRow[]);
    setReturned(returnedMap);
    setAccounts((accountsRes.data ?? []) as AccountRow[]);
    const settings = settingsRes.data as {
      iva_rate: number | string;
      iva_enabled: boolean;
    } | null;
    setIvaRate(toNumber(settings?.iva_rate, 16));
    setIvaOn(settings?.iva_enabled ?? true);
    setLoading(false);
  }, [open, saleId, accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const remainingOf = useCallback(
    (item: ItemRow) =>
      Math.max(
        round2(toNumber(item.quantity) - (returned.get(item.id) ?? 0)),
        0,
      ),
    [returned],
  );

  const lines = useMemo(() => {
    return items
      .map((item) => {
        const sold = toNumber(item.quantity);
        const available = Math.max(
          sold - (returned.get(item.id) ?? 0),
          0,
        );
        const qty = Math.min(
          Math.max(toNumber(quantities[item.id] ?? "0"), 0),
          available,
        );
        const net = round2(toNumber(item.line_total_usd) * (qty / sold));
        const tax =
          item.taxable && ivaOn ? round2((net * ivaRate) / 100) : 0;
        return { item, qty, net, tax, total: round2(net + tax) };
      })
      .filter((line) => line.qty > 0);
  }, [items, quantities, ivaRate, ivaOn, returned]);

  const totals = useMemo(() => {
    const net = round2(lines.reduce((sum, line) => sum + line.net, 0));
    const tax = round2(lines.reduce((sum, line) => sum + line.tax, 0));
    return { net, tax, total: round2(net + tax) };
  }, [lines]);

  const hasBalance = toNumber(sale?.balance_usd) > 0.005;

  function setQuantity(item: ItemRow, value: string) {
    setQuantities((current) => ({
      ...current,
      [item.id]: value,
    }));
  }

  function returnAll() {
    const next: Record<string, string> = {};
    for (const item of items) {
      const remaining = remainingOf(item);
      if (remaining > 0) next[item.id] = String(remaining);
    }
    setQuantities(next);
  }

  async function submit() {
    if (!sale || lines.length === 0) {
      setError("Indica al menos una cantidad a devolver.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Escribe el motivo de la devolución.");
      return;
    }
    if (hasBalance && refundAccountId) {
      setError("La venta tiene saldo: la devolución debe ser nota de crédito.");
      return;
    }
    if (
      hasBalance &&
      totals.total > toNumber(sale.balance_usd) + 0.005
    ) {
      setError(
        "La devolución supera el saldo pendiente. Devuelve menos o cobra la venta primero.",
      );
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc(
      "pos_create_sale_return",
      {
        p_sale_id: sale.id,
        p_items: lines.map((line) => ({
          sale_item_id: line.item.id,
          quantity: line.qty,
        })),
        p_reason: reason.trim(),
        p_refund_account_id: refundAccountId || null,
        p_rate: rate,
      },
    );
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const payload = data as { number: number; total_usd: number };
    setResult({
      number: payload.number,
      total: toNumber(payload.total_usd),
    });
    onReturned();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              {result
                ? `Devolución #${result.number} registrada`
                : `Devolución de venta #${sale?.number ?? ""}`}
            </h2>
            <p className="text-xs text-slate-500">
              {result
                ? "El inventario y la caja ya quedaron actualizados."
                : "Elige las cantidades y cómo se devuelve el dinero."}
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

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
            </div>
          ) : result ? (
            <div className="rounded-xl bg-emerald-50 px-5 py-8 text-center">
              <RotateCcw className="mx-auto h-8 w-8 text-emerald-600" />
              <p className="mt-2 text-sm font-bold text-emerald-800">
                Se devolvieron {formatUsd(result.total)}
              </p>
              <p className="mt-1 text-xs text-emerald-700">
                La venta queda registrada con su devolución y el stock volvió.
              </p>
            </div>
          ) : error && !sale ? (
            <p className="rounded-xl bg-red-50 px-4 py-6 text-center text-sm text-red-700">
              {error}
            </p>
          ) : sale ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-400">
                    Total
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    {formatUsd(toNumber(sale.total_usd))}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-400">
                    Ya devuelto
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    {formatUsd(toNumber(sale.returned_usd))}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-400">
                    Saldo
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    {formatUsd(toNumber(sale.balance_usd))}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-800">
                  Qué se devuelve
                </p>
                <button
                  type="button"
                  onClick={returnAll}
                  className="text-[11px] font-bold text-[#3f3fd8] hover:underline"
                >
                  Devolver todo lo disponible
                </button>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-[9px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2 text-right">Vendido</th>
                      <th className="px-3 py-2 text-right">Devuelto</th>
                      <th className="px-3 py-2 text-right">Disponible</th>
                      <th className="px-3 py-2 text-right">Devolver</th>
                      <th className="px-3 py-2 text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => {
                      const remaining = remainingOf(item);
                      const line = lines.find((row) => row.item.id === item.id);
                      return (
                        <tr key={item.id}>
                          <td className="px-3 py-2 font-medium text-slate-700">
                            {item.name}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500">
                            {toNumber(item.quantity)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500">
                            {returned.get(item.id) ?? 0}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-700">
                            {remaining}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              value={quantities[item.id] ?? ""}
                              onChange={(event) =>
                                setQuantity(item, event.target.value)
                              }
                              disabled={remaining <= 0}
                              inputMode="decimal"
                              placeholder="0"
                              className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-right text-xs outline-none focus:border-[#3f3fd8] disabled:bg-slate-50"
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-800">
                            {line ? formatUsd(line.total) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Motivo *
                </span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  placeholder="Producto defectuoso, cliente cambió de opinión..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Cómo se devuelve
                </span>
                <select
                  value={refundAccountId}
                  onChange={(event) => setRefundAccountId(event.target.value)}
                  disabled={hasBalance}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8] disabled:bg-slate-50"
                >
                  <option value="">
                    Nota de crédito (no sale dinero)
                  </option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.currency})
                    </option>
                  ))}
                </select>
                {hasBalance ? (
                  <span className="text-[10px] text-amber-700">
                    La venta tiene saldo pendiente: solo se puede dejar como
                    nota de crédito.
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400">
                    Si eliges una cuenta, se registra la salida del dinero y se
                    descuenta del turno.
                  </span>
                )}
              </label>

              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Base</span>
                  <span>{formatUsd(totals.net)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>IVA</span>
                  <span>{formatUsd(totals.tax)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1">
                  <span className="font-bold text-slate-800">
                    Total a devolver
                  </span>
                  <span className="text-lg font-black text-slate-900">
                    {formatUsd(totals.total)}
                  </span>
                </div>
              </div>

              {error ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {result ? (
            <PosButton onClick={() => onOpenChange(false)}>Listo</PosButton>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-[#3f3fd8] hover:bg-slate-50"
              >
                Cancelar
              </button>
              <PosButton
                onClick={() => void submit()}
                disabled={saving || loading || lines.length === 0}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Confirmar devolución
              </PosButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
