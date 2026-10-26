"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  Package,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import { PosButton, PosPageHeader } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, toNumber, usdToBs } from "@/lib/pos/money";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  kind: "product" | "supply" | "service";
  unit: string;
  cost_usd: number | string;
  price_usd: number | string;
  stock: number | string;
}

interface Movement {
  id: string;
  product_id: string;
  kind: "purchase" | "sale" | "return" | "adjustment" | "loss";
  quantity: number | string;
  unit_cost_usd: number | string;
  note: string | null;
  created_at: string;
  product?: { name: string } | null;
}

type Mode = "purchase" | "adjust" | "loss";
type Tab = "existencias" | "movimientos";

const KIND_LABEL: Record<Movement["kind"], string> = {
  purchase: "Compra",
  sale: "Venta",
  return: "Devolución",
  adjustment: "Ajuste",
  loss: "Merma",
};

const KIND_STYLE: Record<Movement["kind"], string> = {
  purchase: "bg-emerald-50 text-emerald-700",
  sale: "bg-indigo-50 text-indigo-700",
  return: "bg-blue-50 text-blue-700",
  adjustment: "bg-amber-50 text-amber-700",
  loss: "bg-red-50 text-red-700",
};

export default function InventarioPage() {
  const { accountId } = useAuth();
  const { rate } = usePosRate();

  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [tab, setTab] = useState<Tab>("existencias");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);

    const [productsRes, movementsRes] = await Promise.all([
      supabase
        .from("pos_products")
        .select("id, name, sku, kind, unit, cost_usd, price_usd, stock")
        .eq("account_id", accountId)
        .eq("active", true)
        .order("name"),
      supabase
        .from("pos_inventory_movements")
        .select(
          "id, product_id, kind, quantity, unit_cost_usd, note, created_at, product:pos_products(name)",
        )
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    setProducts((productsRes.data ?? []) as Product[]);
    setMovements((movementsRes.data ?? []) as unknown as Movement[]);
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
    return movements.filter((movement) => {
      const name = movement.product?.name ?? "";
      return (
        name.toLowerCase().includes(term) ||
        KIND_LABEL[movement.kind].toLowerCase().includes(term)
      );
    });
  }, [movements, term]);

  return (
    <div>
      <PosPageHeader
        title="Inventario"
        subtitle="Consulta lo disponible por producto y ubica cada movimiento."
        actions={
          <>
            <PosButton variant="outline" onClick={() => setMode("adjust")}>
              <SlidersHorizontal className="h-4 w-4" />
              Nuevo ajuste
            </PosButton>
            <PosButton variant="outline" onClick={() => setMode("loss")}>
              <ArrowUpFromLine className="h-4 w-4" />
              Nueva salida
            </PosButton>
            <PosButton onClick={() => setMode("purchase")}>
              <ArrowDownToLine className="h-4 w-4" />
              Registrar compra
            </PosButton>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Valor en inventario (costo)
          </p>
          <p className="mt-1 text-2xl font-black text-slate-900">
            {formatUsd(totals.cost)}
          </p>
          <p className="text-[11px] text-slate-500">
            {formatBs(usdToBs(totals.cost, rate))}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Valor a precio de venta
          </p>
          <p className="mt-1 text-2xl font-black text-slate-900">
            {formatUsd(totals.sale)}
          </p>
          <p className="text-[11px] text-slate-500">
            {formatBs(usdToBs(totals.sale, rate))}
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setTab("existencias")}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              tab === "existencias"
                ? "bg-indigo-50 text-[#3f3fd8]"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            Existencias
          </button>
          <button
            type="button"
            onClick={() => setTab("movimientos")}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              tab === "movimientos"
                ? "bg-indigo-50 text-[#3f3fd8]"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            Movimientos
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              tab === "existencias"
                ? "Buscar por producto o SKU"
                : "Buscar por producto o tipo de movimiento"
            }
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
        </div>
      ) : tab === "existencias" ? (
        filteredProducts.length === 0 ? (
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
                <PosButton onClick={() => setMode("purchase")}>
                  Registrar una compra
                </PosButton>
              ) : null
            }
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Producto</th>
                  <th className="px-4 py-2.5 font-semibold">SKU</th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Existencia
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Costo
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Valor costo
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map((product) => {
                  const stock = toNumber(product.stock);
                  const cost = toNumber(product.cost_usd);
                  return (
                    <tr key={product.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">
                          {product.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {product.kind === "service"
                            ? "Servicio"
                            : product.unit}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {product.sku ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">
                        {product.kind === "service"
                          ? "—"
                          : `${stock} ${product.unit}`}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        {formatUsd(cost)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {product.kind === "service"
                          ? "—"
                          : formatUsd(stock * cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : filteredMovements.length === 0 ? (
        <EmptyState
          title="Todavía no hay movimientos"
          description="Las compras, ventas, ajustes y mermas aparecen aquí."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Fecha</th>
                <th className="px-4 py-2.5 font-semibold">Producto</th>
                <th className="px-4 py-2.5 font-semibold">Tipo</th>
                <th className="px-4 py-2.5 text-right font-semibold">
                  Cantidad
                </th>
                <th className="px-4 py-2.5 text-right font-semibold">
                  Costo unit.
                </th>
                <th className="px-4 py-2.5 font-semibold">Nota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMovements.map((movement) => (
                <tr key={movement.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-slate-500">
                    {new Intl.DateTimeFormat("es-VE", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(movement.created_at))}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {movement.product?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_STYLE[movement.kind]}`}
                    >
                      {KIND_LABEL[movement.kind]}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${
                      toNumber(movement.quantity) < 0
                        ? "text-red-600"
                        : "text-emerald-700"
                    }`}
                  >
                    {toNumber(movement.quantity) > 0 ? "+" : ""}
                    {toNumber(movement.quantity)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    {formatUsd(toNumber(movement.unit_cost_usd))}
                  </td>
                  <td className="max-w-56 truncate px-4 py-3 text-slate-500">
                    {movement.note || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode ? (
        <MovementDialog
          mode={mode}
          products={products.filter((p) => p.kind !== "service")}
          onClose={() => setMode(null)}
          onSaved={() => {
            setMode(null);
            void load();
          }}
        />
      ) : null}
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
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
      <Package className="mx-auto h-8 w-8 text-slate-300" />
      <p className="mt-3 text-sm font-bold text-slate-800">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function MovementDialog({
  mode,
  products,
  onClose,
  onSaved,
}: {
  mode: Mode;
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = products.find((p) => p.id === productId);

  const title =
    mode === "purchase"
      ? "Registrar compra"
      : mode === "adjust"
        ? "Nuevo ajuste de inventario"
        : "Nueva salida de inventario";

  const subtitle =
    mode === "purchase"
      ? "Suma existencias y recalcula el costo medio."
      : mode === "adjust"
        ? "Fija la existencia real después de un conteo."
        : "Resta existencias por merma, daño o uso interno.";

  useEffect(() => {
    if (mode === "purchase" && selected) {
      setUnitCost(String(toNumber(selected.cost_usd)));
    }
  }, [mode, selected]);

  async function save() {
    if (!productId) {
      setError("Selecciona un producto.");
      return;
    }
    const value = toNumber(quantity);
    if (mode === "adjust" && value < 0) {
      setError("La existencia contada no puede ser negativa.");
      return;
    }
    if (mode !== "adjust" && value <= 0) {
      setError("La cantidad debe ser mayor que cero.");
      return;
    }
    if (mode === "purchase" && toNumber(unitCost) < 0) {
      setError("El costo no puede ser negativo.");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();

    const rpc =
      mode === "purchase"
        ? supabase.rpc("pos_register_purchase", {
            p_product_id: productId,
            p_quantity: value,
            p_unit_cost: toNumber(unitCost),
            p_note: note.trim() || null,
          })
        : mode === "adjust"
          ? supabase.rpc("pos_adjust_stock", {
              p_product_id: productId,
              p_counted: value,
              p_note: note.trim() || null,
            })
          : supabase.rpc("pos_register_loss", {
              p_product_id: productId,
              p_quantity: value,
              p_note: note.trim() || null,
            });

    const { error: rpcError } = await rpc;
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSaved();
  }

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

        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Producto
            </span>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className={inputClass}
            >
              {products.length === 0 ? (
                <option value="">Sin productos con inventario</option>
              ) : null}
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · {toNumber(product.stock)} {product.unit}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              {mode === "adjust" ? "Existencia contada" : "Cantidad"}
            </span>
            <input
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="decimal"
              placeholder={mode === "adjust" ? "0" : "0"}
              className={inputClass}
            />
          </label>

          {mode === "purchase" ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-500">
                Costo unitario (USD)
              </span>
              <input
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                inputMode="decimal"
                className={inputClass}
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Nota (opcional)
            </span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Proveedor, factura, motivo..."
              className={inputClass}
            />
          </label>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <PosButton variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </PosButton>
          <PosButton onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar
          </PosButton>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]";
