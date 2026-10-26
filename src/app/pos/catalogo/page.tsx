"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Package, Plus, Search, X } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { PosButton, PosPageHeader } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatUsd, toNumber } from "@/lib/pos/money";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  kind: "product" | "supply" | "service";
  unit: string;
  cost_usd: number | string;
  price_usd: number | string;
  stock: number | string;
  taxable: boolean;
  active: boolean;
}

const KIND_LABEL: Record<Product["kind"], string> = {
  product: "Producto",
  supply: "Insumo",
  service: "Servicio",
};

export default function CatalogoPage() {
  const { accountId } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [initialKind, setInitialKind] = useState<Product["kind"]>("product");

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);
    const { data } = await supabase
      .from("pos_products")
      .select(
        "id, name, sku, kind, unit, cost_usd, price_usd, stock, taxable, active",
      )
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });
    setProducts((data ?? []) as Product[]);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        (product.sku ?? "").toLowerCase().includes(term),
    );
  }, [products, search]);

  function openCreate(kind: Product["kind"]) {
    setInitialKind(kind);
    setOpen(true);
  }

  return (
    <div>
      <PosPageHeader
        title="Catálogo"
        subtitle="Todo lo que vendes, en un solo listado."
        actions={<PosButton onClick={() => openCreate("product")}>
          <Plus className="h-4 w-4" />
          Nuevo producto
        </PosButton>}
      />

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre, SKU o código..."
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
          <Package className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-bold text-slate-800">
            Todavía no hay productos
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Empieza por lo que quieres crear: cada tipo te pide solo lo que
            necesita.
          </p>
          <div className="mx-auto mt-6 grid max-w-2xl gap-3 text-left sm:grid-cols-2">
            <KindCard
              title="Producto para vender"
              description="Lo que vendes tal cual: una gaseosa, una camisa."
              onClick={() => openCreate("product")}
            />
            <KindCard
              title="Insumo"
              description="Se compra y se cuenta, pero no se vende solo."
              onClick={() => openCreate("supply")}
            />
            <KindCard
              title="Servicio"
              description="Algo que haces, sin existencia que contar."
              onClick={() => openCreate("service")}
            />
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Producto</th>
                <th className="px-4 py-2.5 font-semibold">Tipo</th>
                <th className="px-4 py-2.5 text-right font-semibold">Costo</th>
                <th className="px-4 py-2.5 text-right font-semibold">Precio</th>
                <th className="px-4 py-2.5 text-right font-semibold">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((product) => (
                <tr key={product.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-800">
                      {product.name}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {product.sku ? product.sku : "Sin SKU"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {KIND_LABEL[product.kind]}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    {formatUsd(toNumber(product.cost_usd))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">
                    {formatUsd(toNumber(product.price_usd))}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {product.kind === "service"
                      ? "—"
                      : `${toNumber(product.stock)} ${product.unit}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? (
        <ProductDialog
          accountId={accountId}
          initialKind={initialKind}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function KindCard({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
    >
      <p className="text-sm font-bold text-slate-800">{title}</p>
      <p className="mt-0.5 text-xs text-slate-500">{description}</p>
    </button>
  );
}

function ProductDialog({
  accountId,
  initialKind,
  onClose,
  onSaved,
}: {
  accountId: string | null;
  initialKind: Product["kind"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [kind, setKind] = useState<Product["kind"]>(initialKind);
  const [unit, setUnit] = useState("unidad");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [taxable, setTaxable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!accountId) return;
    if (name.trim().length < 2) {
      setError("Escribe un nombre.");
      return;
    }
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const { error: insertError } = await supabase.from("pos_products").insert({
      account_id: accountId,
      name: name.trim(),
      sku: sku.trim() || null,
      kind,
      unit: unit.trim() || "unidad",
      cost_usd: toNumber(cost),
      price_usd: toNumber(price),
      stock: kind === "service" ? 0 : toNumber(stock),
      taxable,
    });

    setSaving(false);
    if (insertError) {
      setError(
        insertError.code === "23505"
          ? "Ese SKU ya existe en el catálogo."
          : insertError.message,
      );
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Nuevo producto</h2>
            <p className="text-xs text-slate-500">
              Solo pedimos lo necesario para {KIND_LABEL[kind].toLowerCase()}.
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

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre *">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
              placeholder="Ej. Camisa azul"
            />
          </Field>
          <Field label="SKU">
            <input
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              className={inputClass}
              placeholder="CAM-AZ-M"
            />
          </Field>
          <Field label="Tipo">
            <select
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as Product["kind"])
              }
              className={inputClass}
            >
              <option value="product">Producto para vender</option>
              <option value="supply">Insumo</option>
              <option value="service">Servicio</option>
            </select>
          </Field>
          <Field label="Unidad">
            <input
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              className={inputClass}
              placeholder="unidad, kg, hora"
            />
          </Field>
          <Field label="Costo (USD)">
            <input
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              inputMode="decimal"
              className={inputClass}
              placeholder="0,00"
            />
          </Field>
          <Field label="Precio (USD) *">
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
              className={inputClass}
              placeholder="0,00"
            />
          </Field>
          {kind !== "service" ? (
            <Field label="Existencia inicial">
              <input
                value={stock}
                onChange={(event) => setStock(event.target.value)}
                inputMode="decimal"
                className={inputClass}
              />
            </Field>
          ) : null}
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={taxable}
            onChange={(event) => setTaxable(event.target.checked)}
            className="h-4 w-4 accent-[#3f3fd8]"
          />
          Aplica IVA (16%)
        </label>

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
            Guardar producto
          </PosButton>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}
