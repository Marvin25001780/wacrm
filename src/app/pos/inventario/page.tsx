"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Loader2,
  Package,
  Search,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import { PosButton, PosPageHeader } from "@/components/pos/pos-shell";
import {
  AdjustmentDialog,
  PurchaseDialog,
  ReturnDialog,
  SupplierPaymentDialog,
  type DialogAccount,
  type DialogProduct,
} from "@/components/pos/inventory-dialogs";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, toNumber, usdToBs } from "@/lib/pos/money";

interface Product extends DialogProduct {
  sku: string | null;
  price_usd: number | string;
  min_stock: number | string;
  category_id: string | null;
}

interface Movement {
  id: string;
  product_id: string;
  kind: "purchase" | "sale" | "return" | "adjustment" | "loss";
  quantity: number | string;
  unit_cost_usd: number | string;
  note: string | null;
  created_at: string;
  created_by: string | null;
  sale_id: string | null;
  doc_id: string | null;
  product?: { name: string } | null;
  sale?: { number: number } | null;
  doc?: { kind: string; invoice_number: string | null; adjustment_type: string | null } | null;
}

interface Doc {
  id: string;
  kind: "purchase" | "return" | "adjustment";
  adjustment_type: "count" | "loss" | null;
  doc_date: string;
  invoice_number: string | null;
  note: string | null;
  total_usd: number | string;
  supplier_name?: string | null;
  status?: "paid" | "credit" | null;
  paid_usd?: number | string;
  balance_usd?: number | string;
  due_date?: string | null;
  created_at: string;
  created_by: string | null;
  items?: { count: number }[];
}

type Tab =
  | "existencias"
  | "movimientos"
  | "compras"
  | "por_pagar"
  | "devoluciones"
  | "ajustes";
type DialogState =
  | { mode: "purchase" }
  | { mode: "return" }
  | { mode: "count" }
  | { mode: "loss"; productId?: string }
  | null;

const TABS: { key: Tab; label: string }[] = [
  { key: "existencias", label: "Existencias" },
  { key: "movimientos", label: "Movimientos" },
  { key: "compras", label: "Compras" },
  { key: "por_pagar", label: "Por pagar" },
  { key: "devoluciones", label: "Devoluciones" },
  { key: "ajustes", label: "Ajustes de inventario" },
];

export default function InventarioPage() {
  const { accountId } = useAuth();
  const { rate } = usePosRate();

  const [tab, setTab] = useState<Tab>("existencias");
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [payDoc, setPayDoc] = useState<Doc | null>(null);
  const [accounts, setAccounts] = useState<DialogAccount[]>([]);
  const [team, setTeam] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogState>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);

    const [productsRes, categoriesRes, movementsRes, docsRes, accountsRes, teamRes] =
      await Promise.all([
        supabase
          .from("pos_products")
          .select(
            "id, name, sku, kind, unit, cost_usd, price_usd, stock, min_stock, category_id, is_parent",
          )
          .eq("account_id", accountId)
          .eq("active", true)
          .eq("is_parent", false)
          .order("name"),
        supabase
          .from("pos_categories")
          .select("id, name")
          .eq("account_id", accountId),
        supabase
          .from("pos_inventory_movements")
          .select(
            "id, product_id, kind, quantity, unit_cost_usd, note, created_at, created_by, sale_id, doc_id, product:pos_products(name), sale:pos_sales(number), doc:pos_inventory_docs(kind, invoice_number, adjustment_type)",
          )
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("pos_inventory_docs")
          .select(
            "id, kind, adjustment_type, doc_date, invoice_number, note, total_usd, supplier_name, status, paid_usd, balance_usd, due_date, created_at, created_by, items:pos_inventory_doc_items(count)",
          )
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("pos_accounts")
          .select("id, name, currency")
          .eq("account_id", accountId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("profiles")
          .select("user_id, full_name")
          .eq("account_id", accountId),
      ]);

    let productRows = (productsRes.data ?? []) as unknown as Product[];
    if (productsRes.error) {
      const fallback = await supabase
        .from("pos_products")
        .select(
          "id, name, sku, kind, unit, cost_usd, price_usd, stock, min_stock, category_id",
        )
        .eq("account_id", accountId)
        .eq("active", true)
        .order("name");
      productRows = (fallback.data ?? []) as unknown as Product[];
    }
    setProducts(productRows);
    setCategories((categoriesRes.data ?? []) as { id: string; name: string }[]);
    setMovements((movementsRes.data ?? []) as unknown as Movement[]);
    setDocs((docsRes.data ?? []) as unknown as Doc[]);
    setAccounts((accountsRes.data ?? []) as DialogAccount[]);
    setTeam(
      Object.fromEntries(
        ((teamRes.data ?? []) as { user_id: string; full_name: string | null }[]).map(
          (row) => [row.user_id, row.full_name ?? "—"],
        ),
      ),
    );
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    let cost = 0;
    let sale = 0;
    for (const product of products) {
      if (product.kind === "service") continue;
      const stock = toNumber(product.stock);
      cost += stock * toNumber(product.cost_usd);
      sale += stock * toNumber(product.price_usd);
    }
    return { cost, sale };
  }, [products]);

  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const term = search.trim().toLowerCase();

  const filteredProducts = useMemo(() => {
    if (!term) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        (product.sku ?? "").toLowerCase().includes(term),
    );
  }, [products, term]);

  const filteredMovements = useMemo(() => {
    if (!term) return movements;
    return movements.filter((movement) =>
      (movement.product?.name ?? "").toLowerCase().includes(term),
    );
  }, [movements, term]);

  const docList = useCallback(
    (kind: Doc["kind"]) => {
      const list = docs.filter((doc) => doc.kind === kind);
      if (!term) return list;
      return list.filter(
        (doc) =>
          (doc.invoice_number ?? "").toLowerCase().includes(term) ||
          (doc.note ?? "").toLowerCase().includes(term),
      );
    },
    [docs, term],
  );

  const dialogProducts = products.filter(
    (product) => product.kind !== "service",
  );

  const payables = useMemo(
    () =>
      docs.filter(
        (doc) =>
          doc.kind === "purchase" && toNumber(doc.balance_usd) > 0.005,
      ),
    [docs],
  );

  return (
    <div>
      <PosPageHeader
        title="Inventario"
        subtitle="Consulta lo disponible, registra compras y corrige diferencias."
        actions={
          <>
            <PosButton
              variant="outline"
              onClick={() => setDialog({ mode: "loss" })}
            >
              <ArrowUpFromLine className="h-4 w-4" />
              Nueva salida
            </PosButton>
            <PosButton onClick={() => setDialog({ mode: "count" })}>
              <SlidersHorizontal className="h-4 w-4" />
              Nuevo ajuste
            </PosButton>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setTab(item.key);
              setSearch("");
            }}
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

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Metric
          label="Valor en inventario (costo)"
          usd={totals.cost}
          bs={formatBs(usdToBs(totals.cost, rate))}
        />
        <Metric
          label="Valor a precio de venta"
          usd={totals.sale}
          bs={formatBs(usdToBs(totals.sale, rate))}
        />
      </div>

      {tab !== "existencias" ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              tab === "movimientos"
                ? "Buscar por producto"
                : "Buscar por factura o motivo"
            }
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
        </div>
      ) : (
        <>
          {tab === "existencias" ? (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-slate-800">Existencias</p>
                  <p className="text-xs text-slate-500">
                    Consulta lo disponible por producto.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5">
                    <Search className="h-3.5 w-3.5 text-slate-400" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar por producto o SKU"
                      className="w-48 bg-transparent text-xs outline-none placeholder:text-slate-400"
                    />
                  </div>
                  <PosButton
                    variant="outline"
                    onClick={() => setDialog({ mode: "purchase" })}
                  >
                    <ArrowDownToLine className="h-4 w-4" />
                    Registrar compra
                  </PosButton>
                </div>
              </div>

              {filteredProducts.length === 0 ? (
                <EmptyState
                  title={
                    products.length === 0
                      ? "Todavía no hay existencias"
                      : "Sin resultados"
                  }
                  description={
                    products.length === 0
                      ? "Las existencias aparecen aquí cuando registras una compra."
                      : "Prueba con otro nombre o SKU."
                  }
                  action={
                    products.length === 0 ? (
                      <PosButton onClick={() => setDialog({ mode: "purchase" })}>
                        Registrar una compra
                      </PosButton>
                    ) : null
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Producto</th>
                        <th className="px-4 py-2.5 font-semibold">SKU</th>
                        <th className="px-4 py-2.5 font-semibold">Categoría</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Existencia</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Costo unit.</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Valor a costo</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Valor a venta</th>
                        <th className="px-4 py-2.5 font-semibold">Estado</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredProducts.map((product) => {
                        const stock = toNumber(product.stock);
                        const cost = toNumber(product.cost_usd);
                        const price = toNumber(product.price_usd);
                        const isService = product.kind === "service";
                        const status =
                          isService
                            ? ""
                            : stock <= 0
                              ? "Agotado"
                              : stock <= toNumber(product.min_stock)
                                ? "Bajo"
                                : "";
                        return (
                          <tr key={product.id} className="hover:bg-slate-50/60">
                            <td className="px-4 py-3 font-semibold text-slate-800">
                              {product.name}
                            </td>
                            <td className="px-4 py-3 text-slate-500">
                              {product.sku ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-slate-500">
                              {categoriesById.get(product.category_id ?? "") ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-800">
                              {isService ? "—" : `${stock} ${product.unit}`}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-500">
                              {isService ? "—" : formatUsd(cost)}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-700">
                              {isService ? "—" : formatUsd(stock * cost)}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-700">
                              {isService ? "—" : formatUsd(stock * price)}
                            </td>
                            <td className="px-4 py-3">
                              {status ? (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    status === "Agotado"
                                      ? "bg-red-50 text-red-600"
                                      : "bg-amber-50 text-amber-700"
                                  }`}
                                >
                                  {status}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {isService ? null : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDialog({
                                      mode: "loss",
                                      productId: product.id,
                                    })
                                  }
                                  className="text-xs font-bold text-[#3f3fd8] hover:underline"
                                >
                                  Salida
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {tab === "movimientos" ? (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-sm font-bold text-slate-800">Movimientos</p>
                <p className="text-xs text-slate-500">
                  Libro de entradas y salidas del inventario.
                </p>
              </div>
              {filteredMovements.length === 0 ? (
                <EmptyState
                  title="Todavía no hay movimientos"
                  description="Las compras, ventas, devoluciones y ajustes aparecen aquí."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Fecha</th>
                        <th className="px-4 py-2.5 font-semibold">Producto</th>
                        <th className="px-4 py-2.5 font-semibold">Dirección</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Cantidad</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Costo unit.</th>
                        <th className="px-4 py-2.5 font-semibold">Origen</th>
                        <th className="px-4 py-2.5 font-semibold">Usuario</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredMovements.map((movement) => {
                        const value = toNumber(movement.quantity);
                        return (
                          <tr key={movement.id} className="hover:bg-slate-50/60">
                            <td className="px-4 py-3 text-slate-500">
                              {formatDate(movement.created_at)}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-800">
                              {movement.product?.name ?? "—"}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  value >= 0
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-red-50 text-red-600"
                                }`}
                              >
                                {value >= 0 ? "Entrada" : "Salida"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-700">
                              {Math.abs(value)}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-500">
                              {formatUsd(toNumber(movement.unit_cost_usd))}
                            </td>
                            <td className="px-4 py-3 text-slate-500">
                              {originOf(movement)}
                            </td>
                            <td className="px-4 py-3 text-slate-500">
                              {movement.created_by
                                ? team[movement.created_by] ?? "—"
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {tab === "compras" ? (
            <DocsTable
              title="Compras"
              subtitle="Registra la entrada de mercancía de tus proveedores."
              docs={docList("purchase")}
              team={team}
              action={
                <PosButton onClick={() => setDialog({ mode: "purchase" })}>
                  <ArrowDownToLine className="h-4 w-4" />
                  Nueva compra
                </PosButton>
              }
              empty="Las compras que registres aparecerán aquí."
              columns={["Fecha", "Factura", "Líneas", "Total", "Usuario"]}
              row={(doc) => [
                formatDate(doc.doc_date),
                doc.invoice_number ?? "—",
                String(doc.items?.[0]?.count ?? 0),
                formatUsd(toNumber(doc.total_usd)),
                doc.created_by ? team[doc.created_by] ?? "—" : "—",
              ]}
            />
          ) : null}

          {tab === "por_pagar" ? (
            <section className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    Cuentas por pagar
                  </p>
                  <p className="text-xs text-slate-500">
                    Compras a crédito pendientes de pago.
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">
                    Total por pagar
                  </p>
                  <p className="text-lg font-black text-amber-700">
                    {formatUsd(
                      payables.reduce(
                        (sum, doc) => sum + toNumber(doc.balance_usd),
                        0,
                      ),
                    )}
                  </p>
                </div>
              </div>

              {payables.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <Wallet className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-bold text-slate-800">
                    No hay compras por pagar
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Cuando registres una compra a crédito, aparecerá aquí.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Proveedor</th>
                        <th className="px-4 py-2.5 font-semibold">Factura</th>
                        <th className="px-4 py-2.5 font-semibold">Fecha</th>
                        <th className="px-4 py-2.5 font-semibold">Vence</th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Total
                        </th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Pagado
                        </th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Saldo
                        </th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Pagar
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payables.map((doc) => (
                        <tr key={doc.id} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3 font-medium text-slate-700">
                            {doc.supplier_name ?? "Proveedor"}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {doc.invoice_number ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {formatDate(doc.doc_date)}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {doc.due_date ? formatDate(doc.due_date) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600">
                            {formatUsd(toNumber(doc.total_usd))}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600">
                            {formatUsd(toNumber(doc.paid_usd))}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-amber-700">
                            {formatUsd(toNumber(doc.balance_usd))}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setPayDoc(doc)}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"
                            >
                              <ArrowDownLeft className="h-3 w-3" />
                              Pagar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {tab === "devoluciones" ? (
            <DocsTable
              title="Devoluciones"
              subtitle="Devoluciones a proveedores."
              docs={docList("return")}
              team={team}
              action={
                <PosButton onClick={() => setDialog({ mode: "return" })}>
                  <ArrowUpFromLine className="h-4 w-4" />
                  Nueva devolución
                </PosButton>
              }
              empty="Cuando devuelvas mercancía a un proveedor, aparecerá aquí."
              columns={["Fecha", "Factura", "Líneas", "Total", "Usuario"]}
              row={(doc) => [
                formatDate(doc.doc_date),
                doc.invoice_number ?? "—",
                String(doc.items?.[0]?.count ?? 0),
                formatUsd(toNumber(doc.total_usd)),
                doc.created_by ? team[doc.created_by] ?? "—" : "—",
              ]}
            />
          ) : null}

          {tab === "ajustes" ? (
            <DocsTable
              title="Ajustes de inventario"
              subtitle="Documentos de corrección de inventario."
              docs={docList("adjustment")}
              team={team}
              action={
                <div className="flex gap-2">
                  <PosButton
                    variant="outline"
                    onClick={() => setDialog({ mode: "loss" })}
                  >
                    Nueva salida
                  </PosButton>
                  <PosButton onClick={() => setDialog({ mode: "count" })}>
                    Nuevo ajuste
                  </PosButton>
                </div>
              }
              empty="Los conteos y mermas aparecerán aquí."
              columns={["Fecha", "Tipo", "Motivo", "Líneas", "Usuario"]}
              row={(doc) => [
                formatDate(doc.doc_date),
                doc.adjustment_type === "loss" ? "Merma" : "Conteo",
                doc.note ?? "—",
                String(doc.items?.[0]?.count ?? 0),
                doc.created_by ? team[doc.created_by] ?? "—" : "—",
              ]}
            />
          ) : null}
        </>
      )}

      {dialog?.mode === "purchase" ? (
        <PurchaseDialog
          products={dialogProducts}
          accounts={accounts}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      ) : null}

      {dialog?.mode === "return" ? (
        <ReturnDialog
          products={dialogProducts}
          rate={rate}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      ) : null}

      {dialog?.mode === "count" || dialog?.mode === "loss" ? (
        <AdjustmentDialog
          products={dialogProducts}
          initialType={dialog.mode}
          initialProductId={
            dialog.mode === "loss" ? dialog.productId : undefined
          }
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      ) : null}

      {payDoc ? (
        <SupplierPaymentDialog
          doc={payDoc}
          accounts={accounts}
          onClose={() => setPayDoc(null)}
          onSaved={() => {
            setPayDoc(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function Metric({
  label,
  usd,
  bs,
}: {
  label: string;
  usd: number;
  bs: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black text-slate-900">{formatUsd(usd)}</p>
      <p className="text-[11px] text-slate-500">{bs}</p>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-16 text-center">
      <Boxes className="mx-auto h-8 w-8 text-slate-300" />
      <p className="mt-3 text-sm font-bold text-slate-800">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function DocsTable({
  title,
  subtitle,
  docs,
  action,
  empty,
  columns,
  row,
}: {
  title: string;
  subtitle: string;
  docs: Doc[];
  team: Record<string, string>;
  action: React.ReactNode;
  empty: string;
  columns: string[];
  row: (doc: Doc) => string[];
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-slate-800">{title}</p>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        {action}
      </div>

      {docs.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <Package className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">{empty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="px-4 py-2.5 font-semibold">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50/60">
                  {row(doc).map((value, index) => (
                    <td
                      key={`${doc.id}-${index}`}
                      className="px-4 py-3 text-slate-600 first:font-medium first:text-slate-800"
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function originOf(movement: Movement): string {
  if (movement.sale?.number != null) return `Venta #${movement.sale.number}`;
  if (movement.doc?.kind === "purchase") return "Compra";
  if (movement.doc?.kind === "return") return "Devolución";
  if (movement.doc?.kind === "adjustment") {
    return movement.doc.adjustment_type === "loss" ? "Merma" : "Ajuste";
  }
  if (movement.kind === "loss") return "Merma";
  if (movement.kind === "adjustment") return "Ajuste";
  return "—";
}
