"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
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
  active: boolean;
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

/**
 * Cuenta las referencias de una cuenta en todo el POS. Si tiene alguna,
 * borrarla dejaría el historial sin cuenta, así que se archiva en su lugar.
 * Devuelve null si no se pudo verificar (tabla inexistente se ignora).
 */
async function accountUsageCount(
  supabase: ReturnType<typeof createClient>,
  id: string,
): Promise<number | null> {
  const checks = [
    { table: "pos_transactions", column: "pos_account_id" },
    { table: "pos_sale_payments", column: "pos_account_id" },
    { table: "pos_inventory_docs", column: "pos_account_id" },
    { table: "pos_supplier_payments", column: "pos_account_id" },
    { table: "pos_sale_returns", column: "refund_account_id" },
  ] as const;

  const results = await Promise.all(
    checks.map(({ table, column }) =>
      supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq(column, id),
    ),
  );

  let total = 0;
  for (const result of results) {
    if (result.error) {
      const missing =
        result.error.code === "42P01" || result.error.code === "PGRST205";
      if (!missing) return null;
      continue;
    }
    total += result.count ?? 0;
  }
  return total;
}

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
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [editState, setEditState] = useState<{
    account: Account;
    used: boolean;
  } | null>(null);
  const [deleteState, setDeleteState] = useState<{
    account: Account;
    usage: number;
  } | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);

    const [accountsRes, txRes, pendingRes] = await Promise.all([
      supabase
        .from("pos_accounts")
        .select("id, name, kind, currency, opening_balance, active")
        .eq("account_id", accountId)
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

    const list = (accountsRes.data ?? []) as Account[];
    const txRows = (txRes.data ?? []) as Tx[];
    setAccounts(list);
    setTransactions(txRows);
    setPending((pendingRes.data ?? []) as unknown as PendingSale[]);

    // El saldo sale de la RPC para no depender del límite de movimientos
    // que se cargan en la tabla. Si la RPC falla, se calcula en memoria.
    const entries = await Promise.all(
      list.map(async (account) => {
        const { data, error } = await supabase.rpc("pos_account_balance", {
          p_account_id: account.id,
        });
        if (!error) {
          return [account.id, toNumber(data)] as const;
        }
        let total = toNumber(account.opening_balance);
        for (const tx of txRows) {
          if (tx.pos_account_id !== account.id) continue;
          total += tx.kind === "in" ? toNumber(tx.amount) : -toNumber(tx.amount);
        }
        return [account.id, total] as const;
      }),
    );

    setBalances(new Map(entries));
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.active),
    [accounts],
  );
  const archivedAccounts = useMemo(
    () => accounts.filter((account) => !account.active),
    [accounts],
  );

  const totalUsd = useMemo(() => {
    let total = 0;
    for (const account of activeAccounts) {
      const balance = balances.get(account.id) ?? 0;
      total +=
        account.currency === "USD"
          ? balance
          : rate > 0
            ? balance / rate
            : 0;
    }
    return total;
  }, [activeAccounts, balances, rate]);

  async function startEdit(account: Account) {
    setActionError(null);
    setBusyAccountId(account.id);
    const usage = await accountUsageCount(createClient(), account.id);
    setBusyAccountId(null);
    if (usage == null) {
      setActionError(
        "No se pudo verificar el uso de la cuenta. Intenta de nuevo.",
      );
      return;
    }
    setEditState({ account, used: usage > 0 });
  }

  async function startDelete(account: Account) {
    setActionError(null);
    setBusyAccountId(account.id);
    const usage = await accountUsageCount(createClient(), account.id);
    setBusyAccountId(null);
    if (usage == null) {
      setActionError(
        "No se pudo verificar el uso de la cuenta. Intenta de nuevo.",
      );
      return;
    }
    setDeleteState({ account, usage });
  }

  async function confirmDelete() {
    if (!deleteState || !accountId) return;
    const { account, usage } = deleteState;
    const balance = balances.get(account.id) ?? 0;

    if (usage > 0 && Math.abs(balance) > 0.005) {
      setDeleteState(null);
      setActionError(
        `La cuenta tiene ${account.currency === "USD" ? formatUsd(balance) : formatBs(balance)}. Transfiere el saldo a otra cuenta antes de archivarla.`,
      );
      return;
    }

    setDeleting(true);
    const supabase = createClient();
    const { error } =
      usage > 0
        ? await supabase
            .from("pos_accounts")
            .update({ active: false })
            .eq("id", account.id)
            .eq("account_id", accountId)
        : await supabase
            .from("pos_accounts")
            .delete()
            .eq("id", account.id)
            .eq("account_id", accountId);
    setDeleting(false);

    if (error) {
      setActionError(error.message);
      return;
    }
    setDeleteState(null);
    void load();
  }

  async function reactivate(account: Account) {
    if (!accountId) return;
    setBusyAccountId(account.id);
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("pos_accounts")
      .update({ active: true })
      .eq("id", account.id)
      .eq("account_id", accountId);
    setBusyAccountId(null);
    if (error) {
      setActionError(error.message);
      return;
    }
    void load();
  }

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
            {activeAccounts.length}
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

      {actionError ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <p>{actionError}</p>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="rounded p-0.5 text-red-400 hover:bg-red-100"
            aria-label="Cerrar aviso"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

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
        activeAccounts.length === 0 && archivedAccounts.length === 0 ? (
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
          <>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Cuenta</th>
                    <th className="px-4 py-2.5 font-semibold">Tipo</th>
                    <th className="px-4 py-2.5 font-semibold">Moneda</th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      Saldo
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      En USD
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeAccounts.map((account) => {
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
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              title="Editar cuenta"
                              onClick={() => void startEdit(account)}
                              disabled={busyAccountId === account.id}
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                            >
                              {busyAccountId === account.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Pencil className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              title="Eliminar o archivar"
                              onClick={() => void startDelete(account)}
                              disabled={busyAccountId === account.id}
                              className="rounded-lg border border-slate-200 p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-40"
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
              {activeAccounts.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-500">
                  No hay cuentas activas. Reactiva una archivada o crea una
                  nueva.
                </p>
              ) : null}
            </div>

            {archivedAccounts.length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setShowArchived((value) => !value)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2 text-xs font-bold text-slate-600">
                    <Archive className="h-3.5 w-3.5 text-slate-400" />
                    Cuentas archivadas ({archivedAccounts.length})
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 transition-transform ${
                      showArchived ? "" : "-rotate-90"
                    }`}
                  />
                </button>
                {showArchived ? (
                  <table className="w-full border-t border-slate-100 text-sm">
                    <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Cuenta</th>
                        <th className="px-4 py-2.5 font-semibold">Tipo</th>
                        <th className="px-4 py-2.5 font-semibold">Moneda</th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {archivedAccounts.map((account) => (
                        <tr key={account.id}>
                          <td className="px-4 py-3 text-slate-600">
                            {account.name}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {KIND_LABEL[account.kind] ?? account.kind}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {account.currency}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => void reactivate(account)}
                                disabled={busyAccountId === account.id}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                              >
                                {busyAccountId === account.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3 w-3" />
                                )}
                                Reactivar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            ) : null}
          </>
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
          accounts={activeAccounts}
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

      {editState ? (
        <AccountDialog
          accountId={accountId}
          account={editState.account}
          used={editState.used}
          onClose={() => setEditState(null)}
          onSaved={() => {
            setEditState(null);
            void load();
          }}
        />
      ) : null}

      {deleteState ? (
        <Modal
          title={
            deleteState.usage > 0 ? "Archivar cuenta" : "Eliminar cuenta"
          }
          subtitle={deleteState.account.name}
          onClose={() => (deleting ? null : setDeleteState(null))}
          footer={
            <>
              <button
                type="button"
                onClick={() => setDeleteState(null)}
                disabled={deleting}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-40"
              >
                Cancelar
              </button>
              {deleteState.usage > 0 &&
              Math.abs(balances.get(deleteState.account.id) ?? 0) > 0.005 ? (
                <PosButton onClick={() => setDeleteState(null)}>
                  Entendido
                </PosButton>
              ) : (
                <PosButton
                  onClick={() => void confirmDelete()}
                  disabled={deleting}
                  className={
                    deleteState.usage > 0
                      ? ""
                      : "!bg-red-600 hover:!bg-red-700"
                  }
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {deleteState.usage > 0 ? "Archivar" : "Eliminar"}
                </PosButton>
              )}
            </>
          }
        >
          <div className="space-y-3 text-sm text-slate-600">
            {deleteState.usage > 0 ? (
              <>
                <p>
                  Esta cuenta tiene movimientos registrados. Se archivará para
                  conservar el historial: dejará de aparecer en cobros, gastos y
                  transferencias, y podrás reactivarla cuando quieras.
                </p>
                {Math.abs(balances.get(deleteState.account.id) ?? 0) >
                0.005 ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Tiene un saldo de{" "}
                    {deleteState.account.currency === "USD"
                      ? formatUsd(
                          balances.get(deleteState.account.id) ?? 0,
                        )
                      : formatBs(
                          balances.get(deleteState.account.id) ?? 0,
                        )}
                    . Transfiérelo a otra cuenta antes de archivarla.
                  </p>
                ) : null}
              </>
            ) : (
              <p>
                Esta cuenta no tiene movimientos ni referencias. Se eliminará
                definitivamente.
              </p>
            )}
          </div>
        </Modal>
      ) : null}

      {dialog === "expense" ? (
        <ExpenseDialog
          accounts={activeAccounts}
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
          accounts={activeAccounts}
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
  account,
  used = false,
  onClose,
  onSaved,
}: {
  accountId: string | null;
  account?: Account | null;
  used?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(account);
  const currencyLocked = editing && used;
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState(account?.kind ?? "cash_usd");
  const [currency, setCurrency] = useState<"USD" | "VES">(
    account?.currency ?? "USD",
  );
  const [opening, setOpening] = useState(
    account ? String(account.opening_balance) : "0",
  );
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
    const payload = {
      name: name.trim(),
      kind,
      currency,
      opening_balance: toNumber(opening),
    };
    const { error: saveError } = account
      ? await supabase
          .from("pos_accounts")
          .update(payload)
          .eq("id", account.id)
          .eq("account_id", accountId)
      : await supabase
          .from("pos_accounts")
          .insert({ account_id: accountId, ...payload });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title={editing ? "Editar cuenta" : "Nueva cuenta"}
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
            {editing ? "Guardar cambios" : "Crear cuenta"}
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
                if (!currencyLocked) {
                  setCurrency(
                    event.target.value === "cash_bs" ||
                      event.target.value === "mobile"
                      ? "VES"
                      : "USD",
                  );
                }
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
              disabled={currencyLocked}
              onChange={(event) =>
                setCurrency(event.target.value as "USD" | "VES")
              }
              className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400`}
            >
              <option value="USD">Dólares</option>
              <option value="VES">Bolívares</option>
            </select>
          </label>
        </div>
        {currencyLocked ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            La moneda no se puede cambiar porque la cuenta ya tiene
            movimientos. Si necesitas otra moneda, crea una cuenta nueva.
          </p>
        ) : null}
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
          <span className="text-[10px] text-slate-400">
            {editing
              ? "Cambiarlo ajusta el saldo actual de la cuenta."
              : "Es el punto de partida; no genera un movimiento."}
          </span>
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
