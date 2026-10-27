"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Loader2,
  LockKeyhole,
  Minus,
  Plus,
  Receipt,
  Wallet,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import {
  notifyShiftChanged,
  usePosShift,
} from "@/components/pos/shift-context";
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

interface MethodRow {
  method: string;
  amount: number | string;
  amount_usd: number | string;
}

interface Summary {
  shift_id: string;
  number: number;
  opened_at: string;
  rate_open: number | string;
  opening_usd: number | string;
  opening_bs: number | string;
  sales_usd: number | string;
  sales_count: number;
  expected_usd: number | string;
  expected_bs: number | string;
  by_method: MethodRow[];
}

interface ShiftRow {
  id: string;
  number: number;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  opening_usd: number | string;
  opening_bs: number | string;
  rate_open: number | string;
  expected_usd: number | string;
  expected_bs: number | string;
  counted_usd: number | string | null;
  counted_bs: number | string | null;
  difference_usd: number | string;
  difference_bs: number | string;
  sales_usd: number | string;
  sales_count: number;
  notes_close: string | null;
}

interface ShiftSale {
  id: string;
  number: number;
  total_usd: number | string;
  status: string;
  created_at: string;
}

const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((method) => [method.value, method.label]),
);

const METHOD_CURRENCY: Record<string, "USD" | "VES"> = Object.fromEntries(
  PAYMENT_METHODS.map((method) => [method.value, method.currency]),
);

export default function TurnosPage() {
  const { accountId, user } = useAuth();
  const { rate } = usePosRate();
  const { shift, loading: shiftLoading, missing, refresh: refreshShift } =
    usePosShift();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [sales, setSales] = useState<ShiftSale[]>([]);
  const [history, setHistory] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [openDialog, setOpenDialog] = useState(false);
  const [countedUsd, setCountedUsd] = useState("0");
  const [countedBs, setCountedBs] = useState("0");
  const [closeNote, setCloseNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closedResult, setClosedResult] = useState<{
    number: number;
    difference_usd: number;
    difference_bs: number;
  } | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);
    setLoadError(null);

    if (shift?.id) {
      const { data, error } = await supabase.rpc("pos_shift_summary", {
        p_shift_id: shift.id,
      });
      if (error) {
        setLoadError(error.message);
        setSummary(null);
      } else {
        setSummary(data as Summary);
      }

      const { data: salesData, error: salesError } = await supabase
        .from("pos_sales")
        .select("id, number, total_usd, status, created_at")
        .eq("shift_id", shift.id)
        .neq("status", "void")
        .order("created_at", { ascending: false })
        .limit(8);
      if (!salesError) setSales((salesData ?? []) as ShiftSale[]);
    } else {
      setSummary(null);
      setSales([]);
    }

    const { data: historyData, error: historyError } = await supabase
      .from("pos_shifts")
      .select(
        "id, number, status, opened_at, closed_at, opening_usd, opening_bs, rate_open, expected_usd, expected_bs, counted_usd, counted_bs, difference_usd, difference_bs, sales_usd, sales_count, notes_close",
      )
      .eq("account_id", accountId)
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(30);

    if (historyError) {
      if (!missing) setLoadError(historyError.message);
    } else {
      setHistory((historyData ?? []) as ShiftRow[]);
    }

    setLoading(false);
  }, [accountId, shift?.id, missing]);

  useEffect(() => {
    void load();
  }, [load]);

  const liveDifference = useMemo(() => {
    if (!summary) return { usd: 0, bs: 0, total: 0 };
    const diffUsd = round2(toNumber(countedUsd) - toNumber(summary.expected_usd));
    const diffBs = round2(toNumber(countedBs) - toNumber(summary.expected_bs));
    const useRate = toNumber(summary.rate_open) || rate;
    const total = round2(
      diffUsd + (useRate > 0 ? diffBs / useRate : 0),
    );
    return { usd: diffUsd, bs: diffBs, total };
  }, [summary, countedUsd, countedBs, rate]);

  async function openShift(payload: {
    usd: string;
    bs: string;
    note: string;
  }) {
    const supabase = createClient();
    const { error } = await supabase.rpc("pos_open_shift", {
      p_opening_usd: toNumber(payload.usd),
      p_opening_bs: toNumber(payload.bs),
      p_rate: rate,
      p_note: payload.note.trim() || null,
    });

    if (error) return error.message;

    notifyShiftChanged();
    await refreshShift();
    setOpenDialog(false);
    setClosedResult(null);
    return null;
  }

  async function closeShift() {
    if (!shift) return;
    const message = [
      `¿Cerrar el turno #${shift.number}?`,
      `Esperado: ${formatUsd(toNumber(summary?.expected_usd))} y ${formatBs(
        toNumber(summary?.expected_bs),
      )}`,
      `Contado: ${formatUsd(toNumber(countedUsd))} y ${formatBs(
        toNumber(countedBs),
      )}`,
      `Diferencia: ${formatUsd(liveDifference.usd)} en USD y ${formatBs(
        liveDifference.bs,
      )} en Bs`,
    ].join("\n");

    if (!window.confirm(message)) return;

    setClosing(true);
    setCloseError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pos_close_shift", {
      p_shift_id: shift.id,
      p_counted_usd: toNumber(countedUsd),
      p_counted_bs: toNumber(countedBs),
      p_note: closeNote.trim() || null,
    });
    setClosing(false);

    if (error) {
      setCloseError(error.message);
      return;
    }

    const result = data as {
      number: number;
      difference_usd: number;
      difference_bs: number;
    };
    setClosedResult(result);
    setCountedUsd("0");
    setCountedBs("0");
    setCloseNote("");
    notifyShiftChanged();
    await refreshShift();
    await load();
  }

  const rateForShift = toNumber(summary?.rate_open) || rate;

  return (
    <div className="space-y-4">
      <PosPageHeader
        title="Turnos y caja"
        subtitle="Apertura, cobros del turno y arqueo de efectivo."
        actions={
          shift ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Turno #{shift.number} abierto
            </span>
          ) : null
        }
      />

      {missing ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <p className="font-bold">Falta aplicar la migración 091</p>
          <p className="mt-0.5">
            Ejecuta <code>supabase/migrations/091_pos_shifts.sql</code> en
            Supabase para activar los turnos.
          </p>
        </div>
      ) : null}

      {closedResult ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="font-bold text-emerald-800">
              Turno #{closedResult.number} cerrado
            </p>
            <p className="text-xs text-emerald-700">
              Diferencia: {formatUsd(closedResult.difference_usd)} ·{" "}
              {formatBs(closedResult.difference_bs)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setClosedResult(null)}
            className="rounded-lg p-1 text-emerald-600 hover:bg-emerald-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {loadError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {loadError}
        </p>
      ) : null}

      {shiftLoading || loading ? (
        <div className="flex justify-center rounded-2xl border border-slate-200 bg-white py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
        </div>
      ) : !shift ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <LockKeyhole className="h-6 w-6" />
            </span>
            <h2 className="mt-3 text-lg font-black text-slate-900">
              La caja está cerrada
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Abre un turno con el fondo inicial para que las ventas, gastos y
              transferencias entren en el arqueo.
            </p>
            <div className="mt-5 flex justify-center">
              <PosButton onClick={() => setOpenDialog(true)} disabled={missing}>
                <Plus className="h-4 w-4" />
                Abrir turno
              </PosButton>
            </div>
          </section>

          <LastClose shift={history[0] ?? null} rate={rate} />
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Ventas del turno"
              value={formatUsd(toNumber(summary?.sales_usd))}
              hint={formatBs(
                usdToBs(toNumber(summary?.sales_usd), rateForShift),
              )}
              icon={<Wallet className="h-4 w-4" />}
            />
            <Kpi
              label="Tickets"
              value={String(summary?.sales_count ?? 0)}
              hint={
                summary && summary.sales_count > 0
                  ? `Promedio ${formatUsd(
                      toNumber(summary.sales_usd) / summary.sales_count,
                    )}`
                  : "Sin ventas todavía"
              }
              icon={<Receipt className="h-4 w-4" />}
            />
            <Kpi
              label="Efectivo esperado"
              value={formatUsd(toNumber(summary?.expected_usd))}
              hint={`Fondo ${formatUsd(toNumber(summary?.opening_usd))}`}
              icon={<Wallet className="h-4 w-4" />}
            />
            <Kpi
              label="Efectivo esperado Bs"
              value={formatBs(toNumber(summary?.expected_bs))}
              hint={`Fondo ${formatBs(toNumber(summary?.opening_bs))} · Tasa ${
                rateForShift > 0 ? formatBs(rateForShift) : "sin tasa"
              }`}
              icon={<Wallet className="h-4 w-4" />}
              small
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div>
                    <p className="text-sm font-bold text-slate-800">
                      Cobros por método
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Turno abierto {formatDate(shift.opened_at)}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                    {user?.email?.split("@")[0] ?? "Cajero"}
                  </span>
                </div>

                {!summary || summary.by_method.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-400">
                    Aún no hay cobros en este turno.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Método</th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Cobrado
                        </th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Equivalente
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {summary.by_method.map((row) => {
                        const currency =
                          METHOD_CURRENCY[row.method] ?? "USD";
                        return (
                          <tr key={row.method}>
                            <td className="px-4 py-2.5 font-semibold text-slate-700">
                              {METHOD_LABEL[row.method] ?? row.method}
                            </td>
                            <td className="px-4 py-2.5 text-right text-slate-600">
                              {currency === "VES"
                                ? formatBs(toNumber(row.amount))
                                : formatUsd(toNumber(row.amount_usd))}
                            </td>
                            <td className="px-4 py-2.5 text-right text-slate-500">
                              {currency === "VES"
                                ? formatUsd(toNumber(row.amount_usd))
                                : formatBs(
                                    usdToBs(
                                      toNumber(row.amount_usd),
                                      rateForShift,
                                    ),
                                  )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <p className="text-sm font-bold text-slate-800">
                    Ventas del turno
                  </p>
                  <span className="text-[11px] text-slate-400">
                    Últimas {sales.length}
                  </span>
                </div>
                {sales.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-slate-400">
                    Sin ventas todavía.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {sales.map((sale) => (
                      <li
                        key={sale.id}
                        className="flex items-center justify-between px-4 py-2.5"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-700">
                            Ticket #{sale.number}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {formatTime(sale.created_at)}
                            {sale.status === "credit" ? " · A crédito" : ""}
                          </p>
                        </div>
                        <p className="text-sm font-bold text-slate-900">
                          {formatUsd(toNumber(sale.total_usd))}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-[#3f3fd8]">
                  <Clock className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    Arqueo de caja
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Cuenta el efectivo físico y ciérralo.
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">
                      Esperado USD
                    </p>
                    <p className="text-sm font-bold text-slate-800">
                      {formatUsd(toNumber(summary?.expected_usd))}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">
                      Esperado Bs
                    </p>
                    <p className="text-sm font-bold text-slate-800">
                      {formatBs(toNumber(summary?.expected_bs))}
                    </p>
                  </div>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-700">
                    Efectivo contado en dólares
                  </span>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="text-sm text-slate-400">$</span>
                    <input
                      value={countedUsd}
                      onChange={(event) => setCountedUsd(event.target.value)}
                      inputMode="decimal"
                      className="w-full bg-transparent text-right text-sm outline-none"
                    />
                  </div>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-700">
                    Efectivo contado en bolívares
                  </span>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="text-sm text-slate-400">Bs</span>
                    <input
                      value={countedBs}
                      onChange={(event) => setCountedBs(event.target.value)}
                      inputMode="decimal"
                      className="w-full bg-transparent text-right text-sm outline-none"
                    />
                  </div>
                </label>

                <div
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                    Math.abs(liveDifference.total) < 0.005
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-800"
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-semibold">
                    {Math.abs(liveDifference.total) < 0.005 ? (
                      <Minus className="h-3 w-3" />
                    ) : liveDifference.total > 0 ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3" />
                    )}
                    Diferencia
                  </span>
                  <span className="text-right">
                    <strong>{formatUsd(liveDifference.total)}</strong>
                    <span className="block text-[10px]">
                      {formatUsd(liveDifference.usd)} USD ·{" "}
                      {formatBs(liveDifference.bs)} Bs
                    </span>
                  </span>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-700">
                    Nota del cierre
                  </span>
                  <textarea
                    value={closeNote}
                    onChange={(event) => setCloseNote(event.target.value)}
                    rows={2}
                    placeholder="Opcional"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
                  />
                </label>

                {closeError ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    {closeError}
                  </p>
                ) : null}

                <PosButton
                  onClick={() => void closeShift()}
                  disabled={closing || !summary}
                  className="w-full"
                >
                  {closing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LockKeyhole className="h-4 w-4" />
                  )}
                  Cerrar turno
                </PosButton>
              </div>
            </section>
          </div>
        </>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-slate-800">Historial de turnos</p>
            <p className="text-[11px] text-slate-500">
              Últimos cierres con su diferencia.
            </p>
          </div>
        </div>

        {history.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            Todavía no hay turnos cerrados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Turno</th>
                  <th className="px-3 py-2.5 font-semibold">Apertura</th>
                  <th className="px-3 py-2.5 font-semibold">Cierre</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Ventas</th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    Esperado
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    Contado
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    Diferencia
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((row) => {
                  const difference = toNumber(row.difference_usd);
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-semibold text-slate-700">
                        #{row.number}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-slate-500">
                        {formatDate(row.opened_at)}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-slate-500">
                        {row.closed_at ? formatDate(row.closed_at) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-600">
                        {formatUsd(toNumber(row.sales_usd))}
                        <span className="block text-[10px] text-slate-400">
                          {row.sales_count} tickets
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-[11px] text-slate-500">
                        {formatUsd(toNumber(row.expected_usd))}
                        <span className="block">
                          {formatBs(toNumber(row.expected_bs))}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-[11px] text-slate-500">
                        {formatUsd(toNumber(row.counted_usd))}
                        <span className="block">
                          {formatBs(toNumber(row.counted_bs))}
                        </span>
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-bold ${
                          Math.abs(difference) < 0.005
                            ? "text-emerald-600"
                            : "text-red-600"
                        }`}
                      >
                        {formatUsd(difference)}
                        <span className="block text-[10px] font-normal">
                          {formatBs(toNumber(row.difference_bs))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {openDialog ? (
        <OpenShiftDialog
          rate={rate}
          onClose={() => setOpenDialog(false)}
          onOpen={openShift}
        />
      ) : null}
    </div>
  );
}

function OpenShiftDialog({
  rate,
  onClose,
  onOpen,
}: {
  rate: number;
  onClose: () => void;
  onOpen: (payload: {
    usd: string;
    bs: string;
    note: string;
  }) => Promise<string | null>;
}) {
  const [usd, setUsd] = useState("0");
  const [bs, setBs] = useState("0");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const message = await onOpen({ usd, bs, note });
    setSaving(false);
    if (message) setError(message);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-xl font-black text-slate-900">Abrir turno</h2>
            <p className="text-xs text-slate-500">
              Registra el fondo con el que empieza la caja.
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

        <div className="space-y-3 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">
                Fondo en dólares
              </span>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <span className="text-sm text-slate-400">$</span>
                <input
                  value={usd}
                  onChange={(event) => setUsd(event.target.value)}
                  inputMode="decimal"
                  className="w-full bg-transparent text-right text-sm outline-none"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">
                Fondo en bolívares
              </span>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <span className="text-sm text-slate-400">Bs</span>
                <input
                  value={bs}
                  onChange={(event) => setBs(event.target.value)}
                  inputMode="decimal"
                  className="w-full bg-transparent text-right text-sm outline-none"
                />
              </div>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-slate-700">Nota</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="Opcional: quién entrega, observaciones..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
            />
          </label>

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            Tasa del turno:{" "}
            <strong className="text-slate-700">
              {rate > 0 ? formatBs(rate) : "sin tasa"}
            </strong>
            . Solo puede haber un turno abierto por negocio.
          </p>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-[#3f3fd8] hover:bg-slate-50"
          >
            Cancelar
          </button>
          <PosButton onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Abrir turno
          </PosButton>
        </div>
      </div>
    </div>
  );
}

function LastClose({ shift, rate }: { shift: ShiftRow | null; rate: number }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-bold text-slate-800">Último cierre</p>
      {!shift ? (
        <p className="mt-3 text-sm text-slate-400">Todavía no hay cierres.</p>
      ) : (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Turno</span>
            <span className="font-bold text-slate-800">#{shift.number}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Fecha</span>
            <span className="text-[11px] text-slate-600">
              {shift.closed_at ? formatDate(shift.closed_at) : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Ventas</span>
            <span className="font-semibold text-slate-700">
              {formatUsd(toNumber(shift.sales_usd))}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Diferencia</span>
            <span
              className={`font-bold ${
                Math.abs(toNumber(shift.difference_usd)) < 0.005
                  ? "text-emerald-600"
                  : "text-red-600"
              }`}
            >
              {formatUsd(toNumber(shift.difference_usd))}
            </span>
          </div>
          <p className="text-[10px] text-slate-400">
            {formatBs(toNumber(shift.difference_bs))} · Tasa{" "}
            {toNumber(shift.rate_open) > 0
              ? formatBs(toNumber(shift.rate_open))
              : formatBs(rate)}
          </p>
        </div>
      )}
    </section>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon,
  small,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-[#3f3fd8]">
          {icon}
        </span>
      </div>
      <p
        className={`mt-1 font-black tracking-tight text-slate-900 ${
          small ? "text-lg" : "text-2xl"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Caracas",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("es-VE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Caracas",
  }).format(new Date(value));
}
