"use client";

import { useState } from "react";
import { Loader2, Wallet, X } from "lucide-react";

import { usePosRate } from "@/components/pos/rate-context";
import { PosButton } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import {
  PAYMENT_METHODS,
  formatBs,
  formatUsd,
  round2,
  toNumber,
  usdToBs,
} from "@/lib/pos/money";

export interface CollectSale {
  id: string;
  number: number;
  total_usd: number | string;
  balance_usd: number | string;
  customer?: { name: string | null } | null;
}

export interface CollectAccount {
  id: string;
  name: string;
  currency: "USD" | "VES";
}

export function CollectCreditDialog({
  sale,
  accounts,
  onClose,
  onSaved,
}: {
  sale: CollectSale;
  accounts: CollectAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rate } = usePosRate();
  const [amount, setAmount] = useState(
    toNumber(sale.balance_usd).toFixed(2),
  );
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [method, setMethod] = useState("cash_usd");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    collected: number;
    balance: number;
  } | null>(null);

  const account = accounts.find((row) => row.id === accountId) ?? null;
  const value = round2(toNumber(amount));
  const native =
    account?.currency === "VES"
      ? formatBs(usdToBs(value, rate))
      : formatUsd(value);

  async function submit() {
    if (!accountId) {
      setError("Elige la cuenta donde entra el dinero.");
      return;
    }
    if (value <= 0) {
      setError("Escribe un monto mayor a cero.");
      return;
    }
    if (value > toNumber(sale.balance_usd) + 0.005) {
      setError("El abono no puede superar el saldo.");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("pos_collect_credit", {
      p_sale_id: sale.id,
      p_amount: value,
      p_account_id: accountId,
      p_method: method,
      p_reference: reference.trim() || null,
      p_rate: rate,
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const payload = data as {
      collected_usd: number;
      balance_usd: number;
    };
    setResult({
      collected: toNumber(payload.collected_usd),
      balance: toNumber(payload.balance_usd),
    });
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-900">
              Cobrar venta #{sale.number}
            </h2>
            <p className="text-xs text-slate-500">
              Saldo pendiente {formatUsd(toNumber(sale.balance_usd))} ·{" "}
              {sale.customer?.name ?? "Consumidor final"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {result ? (
          <div className="px-5 py-6 text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Wallet className="h-5 w-5" />
            </span>
            <p className="mt-2 text-sm font-bold text-emerald-800">
              Cobrado {formatUsd(result.collected)}
            </p>
            <p className="text-xs text-emerald-700">
              {result.balance > 0.005
                ? `Queda un saldo de ${formatUsd(result.balance)}`
                : "La venta quedó pagada por completo."}
            </p>
          </div>
        ) : (
          <div className="space-y-3 px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Monto a cobrar
                </span>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <span className="text-sm text-slate-400">$</span>
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    className="w-full bg-transparent text-right text-sm outline-none"
                  />
                </div>
                <span className="text-[10px] text-slate-400">
                  {native} en la cuenta
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Cuenta
                </span>
                <select
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
                >
                  {accounts.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} ({row.currency})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Método
                </span>
                <select
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
                >
                  {PAYMENT_METHODS.map((row) => (
                    <option key={row.value} value={row.value}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Referencia
                </span>
                <input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Opcional"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
                />
              </label>
            </div>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            ) : null}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {result ? (
            <PosButton onClick={onClose}>Listo</PosButton>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-[#3f3fd8] hover:bg-slate-50"
              >
                Cancelar
              </button>
              <PosButton onClick={() => void submit()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Registrar cobro
              </PosButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
