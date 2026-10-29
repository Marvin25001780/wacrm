"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { PosButton } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, toNumber, usdToBs } from "@/lib/pos/money";
import {
  fixedByCategory,
  fixedTotal,
  type FixedExpense,
} from "@/lib/pos/break-even";

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]";

interface PaymentRow {
  fixed_expense_id: string;
  amount_usd: number | string;
  paid_at: string;
  pos_account_id: string | null;
}

interface AccountOption {
  id: string;
  name: string;
  currency: "USD" | "VES";
}

/** Primer día del mes actual, en formato YYYY-MM-01. */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export function FixedExpensesTab({
  accountId,
  rate,
  accounts,
}: {
  accountId: string | null;
  rate: number;
  accounts: AccountOption[];
}) {
  const [rows, setRows] = useState<FixedExpense[]>([]);
  const [payments, setPayments] = useState<Map<string, PaymentRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(true);
  const [paymentsReady, setPaymentsReady] = useState(true);
  const [editing, setEditing] = useState<FixedExpense | "new" | null>(null);
  const [paying, setPaying] = useState<FixedExpense | null>(null);
  const [deleting, setDeleting] = useState<FixedExpense | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const period = currentPeriod();

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const supabase = createClient();
    const [expensesRes, paymentsRes] = await Promise.all([
      supabase
        .from("pos_fixed_expenses")
        .select("id, name, category, amount_usd, due_day, active")
        .eq("account_id", accountId)
        .order("amount_usd", { ascending: false }),
      supabase
        .from("pos_fixed_expense_payments")
        .select("fixed_expense_id, amount_usd, paid_at, pos_account_id")
        .eq("account_id", accountId)
        .eq("period_month", period),
    ]);

    if (expensesRes.error) {
      // La migración 103 puede no estar aplicada todavía.
      setReady(false);
      setRows([]);
      setPayments(new Map());
      setPaymentsReady(false);
    } else {
      setReady(true);
      setRows((expensesRes.data ?? []) as FixedExpense[]);
      if (paymentsRes.error) {
        setPaymentsReady(false);
        setPayments(new Map());
      } else {
        setPaymentsReady(true);
        setPayments(
          new Map(
            ((paymentsRes.data ?? []) as PaymentRow[]).map((row) => [
              row.fixed_expense_id,
              row,
            ]),
          ),
        );
      }
    }
    setLoading(false);
  }, [accountId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => rows.filter((row) => row.active), [rows]);
  const total = useMemo(() => fixedTotal(rows), [rows]);
  const byCategory = useMemo(() => fixedByCategory(rows), [rows]);

  const paidTotal = useMemo(() => {
    let sum = 0;
    for (const row of active) {
      const payment = payments.get(row.id);
      if (payment) sum += toNumber(payment.amount_usd);
    }
    return sum;
  }, [active, payments]);

  const pendingTotal = Math.max(0, total - paidTotal);

  const today = new Date().getDate();

  async function toggleActive(row: FixedExpense) {
    if (!accountId) return;
    setBusyId(row.id);
    setError(null);
    const supabase = createClient();
    const { error: saveError } = await supabase
      .from("pos_fixed_expenses")
      .update({ active: !row.active, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("account_id", accountId);
    setBusyId(null);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    void load();
  }

  async function confirmDelete() {
    if (!deleting || !accountId) return;
    setBusyId(deleting.id);
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("pos_fixed_expenses")
      .delete()
      .eq("id", deleting.id)
      .eq("account_id", accountId);
    setBusyId(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setDeleting(null);
    void load();
  }

  if (!ready) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-xs text-amber-800">
        Falta aplicar la migración <strong>103_pos_fixed_expenses.sql</strong> en
        Supabase para registrar gastos fijos mensuales.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-800">
            Gastos fijos del mes
          </p>
          <p className="text-xs text-slate-500">
            Compromisos de {monthLabel(period)}: qué está pagado y qué falta.
          </p>
        </div>
        <PosButton onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" />
          Nuevo gasto fijo
        </PosButton>
      </div>

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="rounded p-0.5 text-red-400 hover:bg-red-100"
            aria-label="Cerrar aviso"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center">
          <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-bold text-slate-800">
            Todavía no hay gastos fijos
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            Carga el alquiler, internet, sueldos y servicios. Con eso Informes
            calcula cuánto necesitas vender al día para cubrirlos.
          </p>
          <div className="mt-4 flex justify-center">
            <PosButton onClick={() => setEditing("new")}>
              Cargar el primero
            </PosButton>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Compromiso mensual
              </p>
              <p className="mt-1 text-2xl font-black text-slate-900">
                {formatUsd(total)}
              </p>
              <p className="text-[11px] text-slate-500">
                {formatBs(usdToBs(total, rate))}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                Pagado este mes
              </p>
              <p className="mt-1 text-2xl font-black text-emerald-800">
                {formatUsd(paidTotal)}
              </p>
              <p className="text-[11px] text-emerald-700">
                {payments.size} de {active.length} gasto(s)
              </p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                Falta por pagar
              </p>
              <p className="mt-1 text-2xl font-black text-amber-800">
                {formatUsd(pendingTotal)}
              </p>
              <p className="text-[11px] text-amber-700">
                {formatBs(usdToBs(pendingTotal, rate))}
              </p>
            </div>
          </div>

          {!paymentsReady ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              No se pudo leer el historial de pagos. Vuelve a ejecutar la
              migración 103 para habilitar el seguimiento.
            </p>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Gasto</th>
                  <th className="px-4 py-2.5 font-semibold">Categoría</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Vence</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Mensual</th>
                  <th className="px-4 py-2.5 font-semibold">Estado</th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const payment = payments.get(row.id);
                  const overdue =
                    row.active && !payment && Number(row.due_day) < today;
                  return (
                    <tr
                      key={row.id}
                      className={row.active ? "" : "bg-slate-50/60 text-slate-400"}
                    >
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {row.name}
                        {row.active ? null : (
                          <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                            Pausado
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-500">
                        {row.category}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        Día {row.due_day}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">
                        {formatUsd(toNumber(row.amount_usd))}
                      </td>
                      <td className="px-4 py-3">
                        {payment ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            {dateLabel(payment.paid_at)}
                          </span>
                        ) : overdue ? (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                            Vencido
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            Pendiente
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {row.active && !payment ? (
                            <button
                              type="button"
                              onClick={() => setPaying(row)}
                              className="rounded-lg border border-emerald-200 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"
                            >
                              Pagar
                            </button>
                          ) : null}
                          <button
                            type="button"
                            title="Editar"
                            onClick={() => setEditing(row)}
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title={row.active ? "Pausar" : "Reactivar"}
                            onClick={() => void toggleActive(row)}
                            disabled={busyId === row.id}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                          >
                            {busyId === row.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : row.active ? (
                              "Pausar"
                            ) : (
                              "Activar"
                            )}
                          </button>
                          <button
                            type="button"
                            title="Eliminar"
                            onClick={() => setDeleting(row)}
                            className="rounded-lg border border-slate-200 p-1.5 text-red-500 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {byCategory.length > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-sm font-bold text-slate-800">
                En qué se va el compromiso
              </p>
              <p className="text-xs text-slate-500">
                Donde más pesa es donde más se nota cualquier recorte.
              </p>
              <div className="mt-3 space-y-2">
                {byCategory.map((row) => {
                  const share = total > 0 ? (row.total / total) * 100 : 0;
                  return (
                    <div key={row.label}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="capitalize text-slate-600">
                          {row.label}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {formatUsd(row.total)} · {share.toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-[#3f3fd8]"
                          style={{ width: `${Math.max(share, 2)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}

      {editing ? (
        <FixedExpenseDialog
          accountId={accountId}
          rate={rate}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      {paying ? (
        <PayDialog
          accountId={accountId}
          rate={rate}
          accounts={accounts}
          row={paying}
          period={period}
          onClose={() => setPaying(null)}
          onSaved={() => {
            setPaying(null);
            void load();
          }}
        />
      ) : null}

      {deleting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-black text-slate-900">
              Eliminar gasto fijo
            </h2>
            <p className="mt-1 text-xs text-slate-500">{deleting.name}</p>
            <p className="mt-3 text-sm text-slate-600">
              Se quitará del compromiso mensual. Si solo quieres dejar de
              contarlo un tiempo, usa <strong>Pausar</strong>.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <PosButton
                onClick={() => void confirmDelete()}
                disabled={busyId === deleting.id}
                className="!bg-red-600 hover:!bg-red-700"
              >
                {busyId === deleting.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Eliminar
              </PosButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FixedExpenseDialog({
  accountId,
  rate,
  row,
  onClose,
  onSaved,
}: {
  accountId: string | null;
  rate: number;
  row: FixedExpense | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row?.name ?? "");
  const [category, setCategory] = useState(row?.category ?? "general");
  const [amount, setAmount] = useState(
    row ? String(toNumber(row.amount_usd)) : "",
  );
  const [dueDay, setDueDay] = useState(row ? String(row.due_day) : "1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!accountId) return;
    if (name.trim().length < 2) {
      setError("Escribe un nombre.");
      return;
    }
    const value = toNumber(amount);
    if (value <= 0) {
      setError("El monto debe ser mayor que cero.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      category: category.trim() || "general",
      amount_usd: value,
      due_day: Math.min(31, Math.max(1, Number(dueDay) || 1)),
      updated_at: new Date().toISOString(),
    };
    const { error: saveError } = row
      ? await supabase
          .from("pos_fixed_expenses")
          .update(payload)
          .eq("id", row.id)
          .eq("account_id", accountId)
      : await supabase
          .from("pos_fixed_expenses")
          .insert({ account_id: accountId, ...payload });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">
              {row ? "Editar gasto fijo" : "Nuevo gasto fijo"}
            </h2>
            <p className="text-xs text-slate-500">
              Compromiso mensual, no un pago del día.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Nombre *
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Alquiler, internet, sueldos..."
              className={inputClass}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-500">
                Categoría
              </span>
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="alquiler"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-500">
                Vence (día)
              </span>
              <input
                value={dueDay}
                onChange={(event) => setDueDay(event.target.value)}
                inputMode="numeric"
                className={inputClass}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Monto mensual en USD *
            </span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="150"
              className={inputClass}
            />
            <span className="text-[10px] text-slate-400">
              {amount
                ? formatBs(usdToBs(toNumber(amount), rate))
                : "Se convierte a bolívares con la tasa del día."}
            </span>
          </label>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <PosButton onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {row ? "Guardar cambios" : "Agregar"}
          </PosButton>
        </div>
      </div>
    </div>
  );
}

function PayDialog({
  accountId,
  rate,
  accounts,
  row,
  period,
  onClose,
  onSaved,
}: {
  accountId: string | null;
  rate: number;
  accounts: AccountOption[];
  row: FixedExpense;
  period: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(String(toNumber(row.amount_usd)));
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const [paidAt, setPaidAt] = useState(todayInput());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = accounts.find((item) => item.id === account);

  async function pay() {
    if (!accountId) return;
    const value = toNumber(amount);
    if (value <= 0) {
      setError("El monto debe ser mayor que cero.");
      return;
    }
    if (!selected) {
      setError("Elige la cuenta desde la que pagas.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    // La RPC recibe el monto en la moneda de la cuenta.
    const charged =
      selected.currency === "VES"
        ? Math.round(value * (rate > 0 ? rate : 0) * 100) / 100
        : value;

    if (selected.currency === "VES" && (rate <= 0 || charged <= 0)) {
      setSaving(false);
      setError("No hay tasa de cambio para pagar en bolívares.");
      return;
    }

    const { error: expenseError } = await supabase.rpc("pos_create_expense", {
      p_account_id: selected.id,
      p_amount: charged,
      p_rate: rate,
      p_description: `Gasto fijo · ${row.name}`,
      p_category: row.category || "general",
    });

    if (expenseError) {
      setSaving(false);
      setError(expenseError.message);
      return;
    }

    const { error: paymentError } = await supabase
      .from("pos_fixed_expense_payments")
      .insert({
        account_id: accountId,
        fixed_expense_id: row.id,
        period_month: period,
        amount_usd: value,
        paid_at: new Date(`${paidAt}T12:00:00`).toISOString(),
        pos_account_id: selected.id,
      });

    setSaving(false);
    if (paymentError) {
      setError(
        `El gasto se registró en Finanzas, pero no se pudo marcar como pagado: ${paymentError.message}`,
      );
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Pagar gasto fijo</h2>
            <p className="text-xs text-slate-500">{row.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Monto en USD
            </span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Pagar desde
            </span>
            <select
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              className={inputClass}
            >
              {accounts.length === 0 ? (
                <option value="">No hay cuentas activas</option>
              ) : null}
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.currency})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Fecha del pago
            </span>
            <input
              type="date"
              value={paidAt}
              onChange={(event) => setPaidAt(event.target.value)}
              className={inputClass}
            />
          </label>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            Se registrará un gasto en Finanzas
            {selected?.currency === "VES" && rate > 0
              ? ` por ${formatBs(toNumber(amount) * rate)}`
              : ""}{" "}
            y quedará marcado como pagado este mes.
          </p>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <PosButton onClick={() => void pay()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Registrar pago
          </PosButton>
        </div>
      </div>
    </div>
  );
}

function todayInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function monthLabel(period: string): string {
  const date = new Date(`${period}T12:00:00`);
  return new Intl.DateTimeFormat("es-VE", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}
