"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import { PosPageHeader } from "@/components/pos/pos-shell";
import {
  BreakdownCard,
  HeatmapCard,
  ProductsCard,
} from "@/components/pos/sales-report-blocks";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, toNumber, usdToBs } from "@/lib/pos/money";
import {
  buildSalesReport,
  keepRatio,
  type ReportNames,
  type SaleItemFact,
  type SalePaymentFact,
} from "@/lib/pos/sales-report";
import {
  bucketAging,
  buildInventoryReport,
  type AgingBucket,
  type InventoryProduct,
} from "@/lib/pos/inventory-report";

type Period = "month" | "lastMonth" | "days30" | "year";
type Tab = "resultados" | "inventario" | "ventas" | "finanzas";

interface SaleRow {
  id: string;
  subtotal_usd: number | string;
  unit_cost_usd: number | string;
  total_usd: number | string;
  balance_usd: number | string;
  returned_usd: number | string;
  status: string;
  created_at: string;
  price_list_id: string | null;
  pos_customer_id: string | null;
  user_id: string | null;
}

interface ReturnRow {
  subtotal_usd: number | string;
  cost_usd: number | string;
  created_at?: string;
}

interface TxRow {
  category: string;
  kind: "in" | "out";
  amount_usd: number | string;
  description: string | null;
  created_at: string;
}

interface LossRow {
  quantity: number | string;
  unit_cost_usd: number | string;
  created_at: string;
}

interface AccountRow {
  id: string;
  name: string;
  currency: "USD" | "VES";
  opening_balance: number | string;
}

interface PayableRow {
  id: string;
  invoice_number: string | null;
  supplier_name: string | null;
  due_date: string | null;
  balance_usd: number | string;
}

interface CreditRow {
  id: string;
  number: number;
  balance_usd: number | string;
  created_at: string;
}

const PERIODS: { key: Period; label: string }[] = [
  { key: "month", label: "Este mes" },
  { key: "lastMonth", label: "Mes anterior" },
  { key: "days30", label: "Últimos 30 días" },
  { key: "year", label: "Este año" },
];

const TABS: { key: Tab; label: string }[] = [
  { key: "resultados", label: "Resultados" },
  { key: "inventario", label: "Inventario" },
  { key: "ventas", label: "Ventas" },
  { key: "finanzas", label: "Finanzas" },
];

function rangeFor(period: Period): { start: Date; end: Date; prevStart: Date } {
  const now = new Date();
  const end = new Date(now);
  let start: Date;
  let prevStart: Date;

  if (period === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  } else if (period === "lastMonth") {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return {
      start,
      end: new Date(now.getFullYear(), now.getMonth(), 1),
      prevStart,
    };
  } else if (period === "days30") {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    prevStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
    prevStart = new Date(now.getFullYear() - 1, 0, 1);
  }

  return { start, end, prevStart };
}

export default function InformesPage() {
  const { accountId } = useAuth();
  const { rate } = usePosRate();

  const [period, setPeriod] = useState<Period>("month");
  const [tab, setTab] = useState<Tab>("resultados");
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [prevSales, setPrevSales] = useState<SaleRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [prevReturns, setPrevReturns] = useState<ReturnRow[]>([]);
  const [yearReturns, setYearReturns] = useState<ReturnRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [prevTxs, setPrevTxs] = useState<TxRow[]>([]);
  const [losses, setLosses] = useState<LossRow[]>([]);
  const [yearSales, setYearSales] = useState<SaleRow[]>([]);
  const [items, setItems] = useState<SaleItemFact[]>([]);
  const [payments, setPayments] = useState<SalePaymentFact[]>([]);
  const [names, setNames] = useState<ReportNames>({
    priceLists: new Map(),
    customers: new Map(),
    users: new Map(),
    defaultChannelName: null,
  });
  const [channelBySale, setChannelBySale] = useState<Map<string, string>>(
    new Map(),
  );
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [payables, setPayables] = useState<PayableRow[]>([]);
  const [creditSales, setCreditSales] = useState<CreditRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);

    const { start, end, prevStart } = rangeFor(period);
    const yearStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth() - 11,
      1,
    );

    const [
      salesRes,
      prevSalesRes,
      txRes,
      prevTxRes,
      lossRes,
      yearRes,
      returnsRes,
      prevReturnsRes,
      yearReturnsRes,
      itemsRes,
      paymentsRes,
      priceListsRes,
      customersRes,
      saleChannelsRes,
      saleChannelRowsRes,
      productsRes,
      accountsRes,
      payablesRes,
      creditRes,
    ] = await Promise.all([
        supabase
          .from("pos_sales")
          .select(
            "id, subtotal_usd, unit_cost_usd, total_usd, balance_usd, returned_usd, status, created_at, price_list_id, pos_customer_id, user_id",
          )
          .eq("account_id", accountId)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString())
          .neq("status", "void"),
        supabase
          .from("pos_sales")
          .select(
            "id, subtotal_usd, unit_cost_usd, total_usd, balance_usd, returned_usd, status, created_at, price_list_id, pos_customer_id, user_id",
          )
          .eq("account_id", accountId)
          .gte("created_at", prevStart.toISOString())
          .lt("created_at", start.toISOString())
          .neq("status", "void"),
        supabase
          .from("pos_transactions")
          .select("category, kind, amount_usd, description, created_at")
          .eq("account_id", accountId)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString()),
        supabase
          .from("pos_transactions")
          .select("category, kind, amount_usd, description, created_at")
          .eq("account_id", accountId)
          .gte("created_at", prevStart.toISOString())
          .lt("created_at", start.toISOString()),
        supabase
          .from("pos_inventory_movements")
          .select("quantity, unit_cost_usd, created_at")
          .eq("account_id", accountId)
          .eq("kind", "loss")
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString()),
        supabase
          .from("pos_sales")
          .select("subtotal_usd, created_at")
          .eq("account_id", accountId)
          .gte("created_at", yearStart.toISOString())
          .neq("status", "void"),
        supabase
          .from("pos_sale_returns")
          .select("subtotal_usd, cost_usd")
          .eq("account_id", accountId)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString()),
        supabase
          .from("pos_sale_returns")
          .select("subtotal_usd, cost_usd")
          .eq("account_id", accountId)
          .gte("created_at", prevStart.toISOString())
          .lt("created_at", start.toISOString()),
        supabase
          .from("pos_sale_returns")
          .select("subtotal_usd, created_at")
          .eq("account_id", accountId)
          .gte("created_at", yearStart.toISOString()),
        supabase
          .from("pos_sale_items")
          .select(
            "sale_id, product_id, name, quantity, unit_cost_usd, line_total_usd, sale:pos_sales!inner(total_usd, returned_usd, status, created_at), product:pos_products(category:pos_categories(name))",
          )
          .eq("account_id", accountId)
          .gte("sale.created_at", start.toISOString())
          .lt("sale.created_at", end.toISOString())
          .neq("sale.status", "void"),
        supabase
          .from("pos_sale_payments")
          .select("method, amount_usd, sale:pos_sales!inner(created_at, status)")
          .eq("account_id", accountId)
          .gte("sale.created_at", start.toISOString())
          .lt("sale.created_at", end.toISOString())
          .neq("sale.status", "void"),
        supabase
          .from("pos_price_lists")
          .select("id, name")
          .eq("account_id", accountId),
        supabase
          .from("pos_customers")
          .select("id, name")
          .eq("account_id", accountId),
        supabase
          .from("pos_sale_channels")
          .select("id, name, is_default")
          .eq("account_id", accountId),
        supabase
          .from("pos_sales")
          .select("id, sale_channel_id")
          .eq("account_id", accountId)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString())
          .neq("status", "void"),
        supabase
          .from("pos_products")
          .select(
            "id, name, sku, kind, stock, min_stock, cost_usd, price_usd",
          )
          .eq("account_id", accountId)
          .eq("active", true)
          .eq("is_parent", false),
        supabase
          .from("pos_accounts")
          .select("id, name, currency, opening_balance")
          .eq("account_id", accountId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("pos_inventory_docs")
          .select(
            "id, invoice_number, supplier_name, due_date, balance_usd",
          )
          .eq("account_id", accountId)
          .eq("kind", "purchase")
          .eq("status", "credit")
          .gt("balance_usd", 0),
        supabase
          .from("pos_sales")
          .select("id, number, balance_usd, created_at")
          .eq("account_id", accountId)
          .eq("status", "credit")
          .gt("balance_usd", 0)
          .order("created_at", { ascending: true }),
      ]);

    const salesRows = (salesRes.data ?? []) as SaleRow[];
    const userIds = [
      ...new Set(
        salesRows
          .map((sale) => sale.user_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const profilesRes =
      userIds.length > 0
        ? await supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };

    const saleChannels = (saleChannelsRes.data ?? []) as {
      id: string;
      name: string;
      is_default: boolean;
    }[];
    const channelNames = new Map(
      saleChannels.map((row) => [row.id, row.name]),
    );
    const defaultChannelName = saleChannelsRes.error
      ? null
      : (saleChannels.find((row) => row.is_default)?.name ??
        saleChannels[0]?.name ??
        null);

    setChannelBySale(
      new Map(
        ((saleChannelRowsRes.data ?? []) as {
          id: string;
          sale_channel_id: string | null;
        }[])
          .filter((row) => row.sale_channel_id)
          .map((row) => [
            row.id,
            channelNames.get(row.sale_channel_id as string) ?? "Sin canal",
          ]),
      ),
    );

    setNames({
      priceLists: new Map(
        ((priceListsRes.data ?? []) as { id: string; name: string }[]).map(
          (row) => [row.id, row.name],
        ),
      ),
      customers: new Map(
        ((customersRes.data ?? []) as { id: string; name: string }[]).map(
          (row) => [row.id, row.name],
        ),
      ),
      users: new Map(
        ((profilesRes.data ?? []) as { user_id: string; full_name: string }[]).map(
          (row) => [row.user_id, row.full_name],
        ),
      ),
      defaultChannelName,
    });
    setItems((itemsRes.data ?? []) as unknown as SaleItemFact[]);
    setPayments((paymentsRes.data ?? []) as unknown as SalePaymentFact[]);

    // `is_parent` llega con la 097; si no está aplicada, se lee sin ella.
    let productRows = (productsRes.data ?? []) as InventoryProduct[];
    if (productsRes.error) {
      const fallback = await supabase
        .from("pos_products")
        .select("id, name, sku, kind, stock, min_stock, cost_usd, price_usd")
        .eq("account_id", accountId)
        .eq("active", true);
      productRows = (fallback.data ?? []) as InventoryProduct[];
    }
    setProducts(productRows);
    setPayables((payablesRes.data ?? []) as PayableRow[]);
    setCreditSales((creditRes.data ?? []) as CreditRow[]);

    // Saldos por cuenta: la RPC manda; si falla, se calcula con el inicial.
    const accountRows = (accountsRes.data ?? []) as AccountRow[];
    setAccounts(accountRows);
    const balanceEntries = await Promise.all(
      accountRows.map(async (account) => {
        const { data, error } = await supabase.rpc("pos_account_balance", {
          p_account_id: account.id,
        });
        if (!error) return [account.id, toNumber(data)] as const;
        return [account.id, toNumber(account.opening_balance)] as const;
      }),
    );
    setBalances(new Map(balanceEntries));

    setSales(salesRows);
    setPrevSales((prevSalesRes.data ?? []) as SaleRow[]);
    setTxs((txRes.data ?? []) as TxRow[]);
    setPrevTxs((prevTxRes.data ?? []) as TxRow[]);
    setLosses((lossRes.data ?? []) as LossRow[]);
    setYearSales((yearRes.data ?? []) as SaleRow[]);
    setReturns((returnsRes.data ?? []) as ReturnRow[]);
    setPrevReturns((prevReturnsRes.data ?? []) as ReturnRow[]);
    setYearReturns((yearReturnsRes.data ?? []) as ReturnRow[]);
    setLoading(false);
  }, [accountId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(
    () => compute(sales, txs, losses, returns),
    [sales, txs, losses, returns],
  );
  const prevStats = useMemo(
    () => compute(prevSales, prevTxs, [], prevReturns),
    [prevSales, prevTxs, prevReturns],
  );

  const report = useMemo(
    () => buildSalesReport(sales, items, payments, names, channelBySale),
    [sales, items, payments, names, channelBySale],
  );

  const daysInPeriod = useMemo(() => {
    const { start, end } = rangeFor(period);
    return Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 86400000),
    );
  }, [period]);

  const soldByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (!item.product_id) continue;
      const ratio = item.sale
        ? keepRatio(
            toNumber(item.sale.total_usd),
            toNumber(item.sale.returned_usd),
          )
        : 1;
      map.set(
        item.product_id,
        (map.get(item.product_id) ?? 0) + toNumber(item.quantity) * ratio,
      );
    }
    return map;
  }, [items]);

  const inventory = useMemo(
    () => buildInventoryReport(products, soldByProduct, daysInPeriod),
    [products, soldByProduct, daysInPeriod],
  );

  const receivableAging = useMemo(() => {
    const today = Date.now();
    return bucketAging(
      creditSales.map((sale) => ({
        amount: toNumber(sale.balance_usd),
        daysOverdue: Math.floor(
          (today - new Date(sale.created_at).getTime()) / 86400000,
        ),
      })),
    );
  }, [creditSales]);

  const payableAging = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return bucketAging(
      payables.map((row) => ({
        amount: toNumber(row.balance_usd),
        daysOverdue: row.due_date
          ? Math.floor(
              (today.getTime() - new Date(row.due_date).getTime()) / 86400000,
            )
          : null,
      })),
    );
  }, [payables]);

  const receivableTotal = useMemo(
    () =>
      creditSales.reduce((sum, sale) => sum + toNumber(sale.balance_usd), 0),
    [creditSales],
  );
  const payableTotal = useMemo(
    () => payables.reduce((sum, row) => sum + toNumber(row.balance_usd), 0),
    [payables],
  );

  const accountRows = useMemo(
    () =>
      accounts.map((account) => {
        const balance = balances.get(account.id) ?? 0;
        return {
          ...account,
          balance,
          usd:
            account.currency === "USD"
              ? balance
              : rate > 0
                ? balance / rate
                : 0,
        };
      }),
    [accounts, balances, rate],
  );
  const totalAccountsUsd = useMemo(
    () => accountRows.reduce((sum, account) => sum + account.usd, 0),
    [accountRows],
  );

  const monthly = useMemo(() => {
    const months: { key: string; label: string; value: number }[] = [];
    const now = new Date();
    for (let index = 11; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      months.push({
        key: `${date.getFullYear()}-${date.getMonth()}`,
        label: new Intl.DateTimeFormat("es-VE", { month: "short" }).format(date),
        value: 0,
      });
    }
    const byKey = new Map(months.map((month) => [month.key, month]));
    for (const sale of yearSales) {
      const date = new Date(sale.created_at);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.value += toNumber(sale.subtotal_usd);
    }
    for (const row of yearReturns) {
      if (!row.created_at) continue;
      const date = new Date(row.created_at);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.value -= toNumber(row.subtotal_usd);
    }
    return months;
  }, [yearSales, yearReturns]);

  const maxMonth = Math.max(...monthly.map((month) => month.value), 0.01);

  return (
    <div>
      <PosPageHeader
        title="Informes"
        subtitle="Cómo se compone el resultado de tu negocio."
        actions={
          <div className="flex rounded-xl border border-slate-200 bg-white p-1">
            {PERIODS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setPeriod(item.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  period === item.key
                    ? "bg-indigo-50 text-[#3f3fd8]"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-lg px-3 py-2 text-xs font-bold ${
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
      ) : tab === "resultados" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card
              label="Ventas netas"
              value={stats.net}
              rate={rate}
              change={change(stats.net, prevStats.net)}
            />
            <Card
              label="Gastos"
              value={stats.expenses}
              rate={rate}
              change={change(stats.expenses, prevStats.expenses)}
            />
            <Card
              label="Utilidad neta"
              value={stats.netProfit}
              rate={rate}
              change={change(stats.netProfit, prevStats.netProfit)}
              highlight
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-bold text-slate-800">
              Resultados por mes
            </p>
            <p className="text-xs text-slate-500">
              Últimos 12 meses · independiente del período elegido
            </p>
            <div className="mt-4 flex h-40 items-end gap-1.5">
              {monthly.map((month) => (
                <div
                  key={month.key}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                  title={`${month.label}: ${formatUsd(month.value)}`}
                >
                  <div
                    className={`w-full rounded-t ${
                      month.value > 0 ? "bg-[#3f3fd8]" : "bg-slate-200"
                    }`}
                    style={{
                      height:
                        month.value > 0
                          ? `${Math.max((month.value / maxMonth) * 100, 4)}%`
                          : "2px",
                    }}
                  />
                  <span className="text-[9px] uppercase text-slate-400">
                    {month.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-bold text-slate-800">
              De las ventas a tu utilidad
            </p>
            <p className="text-xs text-slate-500">
              Cómo se compone el resultado del período.
            </p>
            <div className="mt-4 divide-y divide-slate-100 text-sm">
              <CascadeRow label="Ventas netas" value={stats.net} rate={rate} />
              <CascadeRow
                label="Costo de lo vendido"
                value={-stats.cogs}
                rate={rate}
              />
              <CascadeRow label="Utilidad bruta" value={stats.gross} rate={rate} bold />
              <CascadeRow label="Gastos" value={-stats.expenses} rate={rate} />
              <CascadeRow label="Comisiones" value={0} rate={rate} />
              <CascadeRow
                label="Pérdidas de inventario"
                value={-stats.losses}
                rate={rate}
              />
              <CascadeRow
                label="Utilidad neta"
                value={stats.netProfit}
                rate={rate}
                bold
              />
            </div>
          </div>
        </div>
      ) : null}

      {!loading && tab === "inventario" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Mini
              label="Inventario a costo"
              value={formatUsd(inventory.costValue)}
              hint={formatBs(usdToBs(inventory.costValue, rate))}
            />
            <Mini
              label="Inventario a venta"
              value={formatUsd(inventory.saleValue)}
              hint={formatBs(usdToBs(inventory.saleValue, rate))}
            />
            <Mini
              label="Margen potencial"
              value={formatUsd(inventory.marginValue)}
              hint={
                inventory.saleValue > 0
                  ? `${((inventory.marginValue / inventory.saleValue) * 100).toFixed(0)}% sobre la venta`
                  : "Sin inventario"
              }
            />
            <Mini
              label="Bajo el mínimo"
              value={String(inventory.lowStock.length)}
              hint={
                inventory.lowStock.length === 0
                  ? "Todo por encima del mínimo"
                  : "Productos por reponer"
              }
            />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-bold text-slate-800">Reponer pronto</p>
            <p className="text-xs text-slate-500">
              Productos en o por debajo del stock mínimo.
            </p>
            {inventory.lowStock.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">
                Ningún producto está bajo el mínimo.
              </p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="pb-2 font-semibold">Producto</th>
                    <th className="pb-2 text-right font-semibold">Stock</th>
                    <th className="pb-2 text-right font-semibold">Mínimo</th>
                    <th className="pb-2 text-right font-semibold">Falta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inventory.lowStock.slice(0, 10).map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 text-slate-700">{row.name}</td>
                      <td className="py-2 text-right text-slate-500">
                        {row.stock}
                      </td>
                      <td className="py-2 text-right text-slate-500">{row.min}</td>
                      <td className="py-2 text-right font-semibold text-red-600">
                        {row.missing > 0 ? row.missing : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-bold text-slate-800">
              Rotación del período
            </p>
            <p className="text-xs text-slate-500">
              Unidades vendidas contra el stock actual. Los días restantes
              estiman cuánto dura el inventario a ese ritmo.
            </p>
            {inventory.rotation.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">
                Sin ventas de productos en el período.
              </p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="pb-2 font-semibold">Producto</th>
                    <th className="pb-2 text-right font-semibold">Vendidos</th>
                    <th className="pb-2 text-right font-semibold">Stock</th>
                    <th className="pb-2 text-right font-semibold">
                      Días restantes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inventory.rotation.slice(0, 12).map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 text-slate-700">{row.name}</td>
                      <td className="py-2 text-right text-slate-500">
                        {Math.round(row.sold)}
                      </td>
                      <td className="py-2 text-right text-slate-500">
                        {row.stock}
                      </td>
                      <td className="py-2 text-right font-semibold text-slate-900">
                        {row.daysLeft == null ? "—" : row.daysLeft}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : null}

      {!loading && tab === "ventas" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Mini label="Vendido" value={formatUsd(stats.net)} hint={formatBs(usdToBs(stats.net, rate))} />
            <Mini label="Ventas" value={String(stats.count)} hint="Sin anuladas" />
            <Mini
              label="Ticket promedio"
              value={formatUsd(stats.avg)}
              hint={formatBs(usdToBs(stats.avg, rate))}
            />
            <Mini
              label="A crédito"
              value={formatUsd(stats.credit)}
              hint={`${stats.credit > 0 ? "Saldo pendiente" : "Ninguno"}`}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownCard
              title="Por canal de venta"
              subtitle="Tienda, delivery u otro canal con el que se registró la venta."
              rows={report.byChannel}
              rate={rate}
              countLabel="Ventas"
            />
            <BreakdownCard
              title="Por lista de precios"
              subtitle="Precios base o de mayorista aplicados en la venta."
              rows={report.byPriceList}
              rate={rate}
              countLabel="Ventas"
            />
            <BreakdownCard
              title="Por cliente"
              subtitle="Ventas netas por cliente registrado."
              rows={report.byCustomer}
              rate={rate}
              countLabel="Ventas"
            />
            <BreakdownCard
              title="Por usuario"
              subtitle="Quién registró las ventas."
              rows={report.byUser}
              rate={rate}
              countLabel="Ventas"
            />
            <BreakdownCard
              title="Por forma de pago"
              subtitle="Cobrado en cada forma de pago, antes de devoluciones."
              rows={report.byPayment}
              rate={rate}
              countLabel="Pagos"
            />
            <BreakdownCard
              title="Por categoría"
              subtitle="Ventas netas de cada categoría de producto."
              rows={report.byCategory}
              rate={rate}
              countLabel="Unid."
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ProductsCard
              title="Más vendidos"
              subtitle="Los cinco productos con más ventas netas."
              rows={report.topProducts}
              rate={rate}
            />
            {report.lessProducts.length > 0 ? (
              <ProductsCard
                title="Menos vendidos"
                subtitle="Los cinco productos con menos unidades vendidas."
                rows={report.lessProducts}
                rate={rate}
              />
            ) : null}
          </div>
          <HeatmapCard
            title="Horas y días pico"
            subtitle="Cantidad de ventas por día y hora (hora de Venezuela). Más color, más ventas."
            heat={report.heat}
            max={report.heatMax}
          />
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
            Para el detalle venta por venta, abre <strong>POS → Ventas → Historial</strong>.
          </p>
        </div>
      ) : null}

      {!loading && tab === "finanzas" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Mini
              label="Ingresos cobrados"
              value={formatUsd(stats.income)}
              hint={formatBs(usdToBs(stats.income, rate))}
            />
            <Mini
              label="Gastos pagados"
              value={formatUsd(stats.expenses)}
              hint={formatBs(usdToBs(stats.expenses, rate))}
            />
            <Mini
              label="Por cobrar"
              value={formatUsd(receivableTotal)}
              hint={`${creditSales.length} venta(s) a crédito`}
            />
            <Mini
              label="Por pagar"
              value={formatUsd(payableTotal)}
              hint={`${payables.length} compra(s) a crédito`}
            />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  Saldos por cuenta
                </p>
                <p className="text-xs text-slate-500">
                  Saldo real de cada cuenta en su moneda.
                </p>
              </div>
              <p className="text-sm font-black text-slate-900">
                {formatUsd(totalAccountsUsd)}
              </p>
            </div>
            {accountRows.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">
                No hay cuentas activas en Finanzas.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {accountRows.map((account) => (
                  <li
                    key={account.id}
                    className="flex items-center justify-between py-2"
                  >
                    <div>
                      <p className="font-semibold text-slate-800">
                        {account.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {account.currency === "USD" ? "Dólares" : "Bolívares"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-semibold ${
                          account.balance < 0 ? "text-red-600" : "text-slate-900"
                        }`}
                      >
                        {account.currency === "USD"
                          ? formatUsd(account.balance)
                          : formatBs(account.balance)}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {formatUsd(account.usd)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <AgingCard
              title="Antigüedad por cobrar"
              subtitle="Días desde la venta a crédito."
              rows={receivableAging}
              rate={rate}
            />
            <AgingCard
              title="Antigüedad por pagar"
              subtitle="Días vencidos según la fecha de pago."
              rows={payableAging}
              rate={rate}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-bold text-slate-800">Gastos por categoría</p>
            {stats.expensesByCategory.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                No hay gastos registrados en el período.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {stats.expensesByCategory.map(([category, value]) => (
                  <li
                    key={category}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="capitalize text-slate-600">{category}</span>
                    <span className="font-semibold text-slate-900">
                      {formatUsd(value)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function compute(
  sales: SaleRow[],
  txs: TxRow[],
  losses: LossRow[],
  returns: ReturnRow[] = [],
) {
  const soldNet = sales.reduce(
    (sum, sale) => sum + toNumber(sale.subtotal_usd),
    0,
  );
  const soldCost = sales.reduce(
    (sum, sale) => sum + toNumber(sale.unit_cost_usd),
    0,
  );
  const returnedNet = returns.reduce(
    (sum, row) => sum + toNumber(row.subtotal_usd),
    0,
  );
  const returnedCost = returns.reduce(
    (sum, row) => sum + toNumber(row.cost_usd),
    0,
  );
  const net = soldNet - returnedNet;
  const cogs = soldCost - returnedCost;
  const credit = sales.reduce(
    (sum, sale) => sum + toNumber(sale.balance_usd),
    0,
  );
  const count = sales.length;

  const expenses = txs
    .filter((tx) => tx.category === "expense" && tx.kind === "out")
    .reduce((sum, tx) => sum + toNumber(tx.amount_usd), 0);

  // Las transferencias entre cuentas mueven dinero pero no son ingresos.
  const income = txs
    .filter((tx) => tx.kind === "in" && tx.category !== "transfer")
    .reduce((sum, tx) => sum + toNumber(tx.amount_usd), 0);

  const byCategory = new Map<string, number>();
  for (const tx of txs) {
    if (tx.category !== "expense" || tx.kind !== "out") continue;
    const label = tx.description?.split(" · ")[1]?.trim() || "general";
    byCategory.set(label, (byCategory.get(label) ?? 0) + toNumber(tx.amount_usd));
  }

  const lossTotal = losses.reduce(
    (sum, loss) =>
      sum + Math.abs(toNumber(loss.quantity)) * toNumber(loss.unit_cost_usd),
    0,
  );

  const gross = net - cogs;

  return {
    net,
    cogs,
    credit,
    count,
    avg: count > 0 ? net / count : 0,
    expenses,
    income,
    losses: lossTotal,
    gross,
    netProfit: gross - expenses - lossTotal,
    expensesByCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function change(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function Card({
  label,
  value,
  rate,
  change,
  highlight,
}: {
  label: string;
  value: number;
  rate: number;
  change: number | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight
          ? "border-indigo-200 bg-indigo-50/60"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black text-slate-900">
        {formatUsd(value)}
      </p>
      <p className="text-[11px] text-slate-500">{formatBs(usdToBs(value, rate))}</p>
      {change != null ? (
        <p
          className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${
            change >= 0 ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {change >= 0 ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {change >= 0 ? "+" : ""}
          {change.toFixed(1)}% vs. período anterior
        </p>
      ) : null}
    </div>
  );
}

function CascadeRow({
  label,
  value,
  rate,
  bold,
}: {
  label: string;
  value: number;
  rate: number;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className={bold ? "font-bold text-slate-800" : "text-slate-600"}>
        {label}
      </span>
      <span className="text-right">
        <span
          className={`block font-semibold ${
            value < 0 ? "text-red-600" : "text-slate-900"
          }`}
        >
          {formatUsd(value)}
        </span>
        <span className="block text-[10px] text-slate-400">
          {formatBs(usdToBs(value, rate))}
        </span>
      </span>
    </div>
  );
}

function Mini({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-black text-slate-900">{value}</p>
      {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function AgingCard({
  title,
  subtitle,
  rows,
  rate,
}: {
  title: string;
  subtitle: string;
  rows: AgingBucket[];
  rate: number;
}) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-bold text-slate-800">{title}</p>
      <p className="text-xs text-slate-500">{subtitle}</p>
      {total <= 0 ? (
        <p className="mt-4 text-xs text-slate-500">Sin saldos pendientes.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2 font-semibold">Tramo</th>
              <th className="pb-2 text-right font-semibold">Docs</th>
              <th className="pb-2 text-right font-semibold">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="py-2 text-slate-700">{row.label}</td>
                <td className="py-2 text-right text-slate-500">{row.count}</td>
                <td className="py-2 text-right">
                  <span className="block font-semibold text-slate-900">
                    {formatUsd(row.total)}
                  </span>
                  <span className="block text-[10px] text-slate-400">
                    {formatBs(usdToBs(row.total, rate))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
