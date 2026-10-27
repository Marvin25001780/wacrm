"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Loader2,
  Plus,
  Wallet,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import { PosButton, PosPageHeader } from "@/components/pos/pos-shell";
import {
  CollectCreditDialog,
  type CollectSale,
} from "@/components/pos/collect-credit-dialog";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, toNumber, usdToBs } from "@/lib/pos/money";

interface Account {
  id: string;
  name: string;
  kind: string;
  currency: "USD" | "VES";
  opening_balance: number | string;
}

interface Tx {
  id: string;
  pos_account_id: string | null;
  kind: "in" | "out";
  category: string;
  description: string | null;
  amount: number | string;
  currency: "USD" | "VES";
  amount_usd: number | string;
  created_at: string;
}

interface PendingSale {
  id: string;
  number: number;
  total_usd: number | string;
  balance_usd: number | string;
  created_at: string;
  customer?: { name: string | null } | null;
}

type Tab = "cuentas" | "movimientos" | "transferencias" | "gastos" | "pendientes";

const TABS: { key: Tab; label: string }[] = [
  { key: "cuentas", label: "Cuentas" },
  { key: "movimientos", label: "Movimientos" },
  { key: "transferencias", label: "Transferencias" },
  { key: "gastos", label: "Gastos" },
  { key: "pendientes", label: "Pendientes" },
];

const KIND_LABEL: Record<string, string> = {
  cash_usd: "Efectivo USD",
  cash_bs: "Efectivo Bs",
  bank: "Banco",
  mobile: "Pago Móvil",
  zelle: "Zelle",
  other: "Otra",
};

export default function FinanzasPage() {
  const { accountId } = useAuth();
  const { rate } = usePosRate();

  const [tab, setTab] = useState<Tab>("cuentas");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [pending, setPending] = useState<PendingSale[]>([]);
  const [collectSale, setCollectSale] = useState<CollectSale | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<"account" | "expense" | "transfer" | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);

    const [accountsRes, txRes, pendingRes] = await Promise.all([
      supabase
        .from("pos_accounts")
        .select("id, name, kind, currency, opening_balance")
        .eq("account_id", accountId)
        .eq("active", true)
        .order("name"),
      supabase
        .from("pos_transactions")
        .select(
          "id, pos_account_id, kind, category, description, amount, currency, amount_usd, created_at",
        )
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("pos_sales")
        .select("id, number, total_usd, balance_usd, created_at, customer:pos_customers(name)")
        .eq("account_id", accountId)
        .eq("status", "credit")
        .gt("balance_usd", 0)
        .order("created_at", { ascending: false }),
    ]);

    setAccounts((accountsRes.data ?? []) as Account[]);
    setTransactions((txRes.data ?? []) as Tx[]);
    setPending((pendingRes.data ?? []) as unknown as PendingSale[]);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    for (const account of accounts) {
      map.set(account.id, toNumber(account.opening_balance));
    }
    for (const tx of transactions) {
      if (!tx.pos_account_id) continue;
      const current = map.get(tx.pos_account_id);
      if (current == null) continue;
      const value = toNumber(tx.amount);
      map.set(tx.pos_account_id, current + (tx.kind === "in" ? value : -value));
    }
    return map;
  }, [accounts, transactions]);

  const totalUsd = useMemo(() => {
    let total = 0;
    for (const account of accounts) {
      const balance = balances.get(account.id) ?? 0;
      total +=
        account.currency === "USD"
          ? balance
          : rate > 0
            ? balance / rate
            : 0;
    }
    return total;
  }, [accounts, balances, rate]);

  const accountName = useCallback(
    (id: string | null) =>
      accounts.find((account) => account.id === id)?.name ?? "—",
    [accounts],
  );

  const gastos = transactions.filter((tx) => tx.category === "expense");
  const transfers = transactions.filter((tx) => tx.category === "transfer");

  return (
    <div>
      <PosPageHeader
        title="Finanzas"
        subtitle="Dónde entra y sale tu dinero: efectivo, bancos y pagos móviles."
        actions={
          <>
            <PosButton variant="outline" onClick={() => setDialog("account")}>
              <Plus className="h-4 w-4" />
              Nueva cuenta
            </PosButton>
            <PosButton variant="outline" onClick={() => setDialog("transfer")}>
              <ArrowLeftRight className="h-4 w-4" />
              Transferir
            </PosButton>
            <PosButton onClick={() => setDialog("expense")}>
              <ArrowUpRight className="h-4 w-4" />
              Registrar gasto
            </PosButton>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Disponible total
          </p>
          <p className="mt-1 text-2xl font-black text-slate-900">
            {formatUsd(totalUsd)}
          </p>
          <p className="text-[11px] text-slate-500">
            {formatBs(usdToBs(totalUsd, rate))}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Cuentas
          </p>
          <p className="mt-1 text-2xl font-black text-slate-900">
            {accounts.length}
          </p>
          <p className="text-[11px] text-slate-500">Activas</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            Por cobrar
          </p>
          <p className="mt-1 text-2xl font-black text-slate-900">
            {formatUsd(
              pending.reduce((sum, sale) => sum + toNumber(sale.balance_usd), 0),
            )}
          </p>
          <p className="text-[11px] text-amber-700">
            {pending.length} venta{pending.length === 1 ? "" : "s"} a crédito
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
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
      ) : tab === "cuentas" ? (
        accounts.length === 0 ? (
          <Empty
            title="Todavía no hay cuentas"
            description="Crea tu primera cuenta para registrar cobros, pagos y gastos."
            action={
              <PosButton onClick={() => setDialog("account")}>
                Crear la primera
              </PosButton>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Cuenta</th>
                  <th className="px-4 py-2.5 font-semibold">Tipo</th>
                  <th className="px-4 py-2.5 font-semibold">Moneda</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Saldo</th>
                  <th className="px-4 py-2.5 text-right font-semibold">En USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((account) => {
                  const balance = balances.get(account.id) ?? 0;
                  const usd =
                    account.currency === "USD"
                      ? balance
                      : rate > 0
                        ? balance / rate
                        : 0;
                  return (
                    <tr key={account.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {account.name}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {KIND_LABEL[account.kind] ?? account.kind}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {account.currency}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">
                        {account.currency === "USD"
                          ? formatUsd(balance)
                          : formatBs(balance)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        {formatUsd(usd)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {!loading && tab === "movimientos" ? (
        <TxTable
          rows={transactions}
          accountName={accountName}
          empty="Los cobros, gastos y transferencias aparecerán aquí."
        />
      ) : null}

      {!loading && tab === "transferencias" ? (
        <TxTable
          rows={transfers}
          accountName={accountName}
          empty="Las transferencias entre cuentas aparecerán aquí."
        />
      ) : null}

      {!loading && tab === "gastos" ? (
        <TxTable
          rows={gastos}
          accountName={accountName}
          empty="Los gastos que registres aparecerán aquí."
        />
      ) : null}

      {!loading && tab === "pendientes" ? (
        pending.length === 0 ? (
          <Empty
            title="Todo al día"
            description="No hay ventas a crédito con saldo pendiente."
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Venta</th>
                  <th className="px-4 py-2.5 font-semibold">Cliente</th>
                  <th className="px-4 py-2.5 font-semibold">Fecha</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Saldo</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Cobrar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.map((sale) => (
                  <tr key={sale.id}>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      #{sale.number}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {sale.customer?.name ?? "Consumidor final"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Intl.DateTimeFormat("es-VE", {
                        day: "2-digit",
                        month: "short",
                      }).format(new Date(sale.created_at))}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {formatUsd(toNumber(sale.total_usd))}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-amber-700">
                      {formatUsd(toNumber(sale.balance_usd))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setCollectSale(sale)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"
                      >
                        <ArrowDownLeft className="h-3 w-3" />
                        Cobrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {collectSale ? (
        <CollectCreditDialog
          sale={collectSale}
          accounts={accounts}
          onClose={() => setCollectSale(null)}
          onSaved={() => void load()}
        />
      ) : null}

      {dialog === "account" ? (
        <AccountDialog
          accountId={accountId}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      ) : null}

      {dialog === "expense" ? (
        <ExpenseDialog
          accounts={accounts}
          rate={rate}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      ) : null}

      {dialog === "transfer" ? (
        <TransferDialog
          accounts={accounts}
          rate={rate}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function TxTable({
  rows,
  accountName,
  empty,
}: {
  rows: Tx[];
  accountName: (id: string | null) => string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <Empty title="Sin movimientos" description={empty} />;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Fecha</th>
            <th className="px-4 py-2.5 font-semibold">Cuenta</th>
            <th className="px-4 py-2.5 font-semibold">Descripción</th>
            <th className="px-4 py-2.5 font-semibold">Tipo</th>
            <th className="px-4 py-2.5 text-right font-semibold">Monto</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((tx) => (
            <tr key={tx.id}>
              <td className="px-4 py-3 text-slate-500">
                {new Intl.DateTimeFormat("es-VE", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(tx.created_at))}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {accountName(tx.pos_account_id)}
              </td>
              <td className="px-4 py-3 text-slate-700">
                {tx.description ?? "—"}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    tx.kind === "in"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-600"
                  }`}
                >
                  {tx.kind === "in" ? (
                    <ArrowDownLeft className="h-3 w-3" />
                  ) : (
                    <ArrowUpRight className="h-3 w-3" />
                  )}
                  {tx.kind === "in" ? "Entrada" : "Salida"}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-bold text-slate-900">
                {tx.currency === "USD"
                  ? formatUsd(toNumber(tx.amount))
                  : formatBs(toNumber(tx.amount))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
      <Wallet className="mx-auto h-8 w-8 text-slate-300" />
      <p className="mt-3 text-sm font-bold text-slate-800">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]";

function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
        <div className="mt-4 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

function AccountDialog({
  accountId,
  onClose,
  onSaved,
}: {
  accountId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("cash_usd");
  const [currency, setCurrency] = useState<"USD" | "VES">("USD");
  const [opening, setOpening] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!accountId) return;
    if (name.trim().length < 2) {
      setError("Escribe un nombre.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("pos_accounts").insert({
      account_id: accountId,
      name: name.trim(),
      kind,
      currency,
      opening_balance: toNumber(opening),
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title="Nueva cuenta"
      subtitle="Efectivo, banco, Pago Móvil o Zelle."
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <PosButton onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Crear cuenta
          </PosButton>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Nombre *
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Efectivo USD, Banco Mercantil..."
            className={inputClass}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Tipo
            </span>
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value);
                setCurrency(
                  event.target.value === "cash_bs" ||
                    event.target.value === "mobile"
                    ? "VES"
                    : "USD",
                );
              }}
              className={inputClass}
            >
              <option value="cash_usd">Efectivo USD</option>
              <option value="cash_bs">Efectivo Bs</option>
              <option value="bank">Banco</option>
              <option value="mobile">Pago Móvil</option>
              <option value="zelle">Zelle</option>
              <option value="other">Otra</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Moneda
            </span>
            <select
              value={currency}
              onChange={(event) =>
                setCurrency(event.target.value as "USD" | "VES")
              }
              className={inputClass}
            >
              <option value="USD">Dólares</option>
              <option value="VES">Bolívares</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Saldo inicial
          </span>
          <input
            value={opening}
            onChange={(event) => setOpening(event.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </label>
      </div>
      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

function ExpenseDialog({
  accounts,
  rate,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  rate: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!accountId || toNumber(amount) <= 0) {
      setError("Elige una cuenta y un monto mayor que cero.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("pos_create_expense", {
      p_account_id: accountId,
      p_amount: toNumber(amount),
      p_rate: rate,
      p_description: description,
      p_category: category,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title="Registrar gasto"
      subtitle="Sale de una cuenta y baja la utilidad."
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <PosButton onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar gasto
          </PosButton>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Cuenta
          </span>
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            className={inputClass}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Monto
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
            Categoría
          </span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={inputClass}
          >
            <option value="general">General</option>
            <option value="alquiler">Alquiler</option>
            <option value="servicios">Servicios</option>
            <option value="sueldos">Sueldos</option>
            <option value="transporte">Transporte</option>
            <option value="publicidad">Publicidad</option>
            <option value="impuestos">Impuestos</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Descripción
          </span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

function TransferDialog({
  accounts,
  rate,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  rate: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [from, setFrom] = useState(accounts[0]?.id ?? "");
  const [to, setTo] = useState(accounts[1]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fromAccount = accounts.find((account) => account.id === from);
  const targets = accounts.filter(
    (account) =>
      account.id !== from &&
      (!fromAccount || account.currency === fromAccount.currency),
  );

  async function save() {
    if (!from || !to || toNumber(amount) <= 0) {
      setError("Elige cuentas y un monto mayor que cero.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("pos_create_transfer", {
      p_from: from,
      p_to: to,
      p_amount: toNumber(amount),
      p_rate: rate,
      p_note: note || null,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title="Transferencia"
      subtitle="Mueve dinero entre cuentas de la misma moneda."
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <PosButton onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Transferir
          </PosButton>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Desde
          </span>
          <select
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setTo("");
            }}
            className={inputClass}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Hacia
          </span>
          <select
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className={inputClass}
          >
            <option value="">Elige una cuenta</option>
            {targets.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Monto
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
            Nota
          </span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
