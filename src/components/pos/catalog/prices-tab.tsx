"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Info,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import { PosButton } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, round2, toNumber, usdToBs } from "@/lib/pos/money";
import type {
  Category,
  PriceList,
  Product,
  ProductPrice,
} from "./types";
import { inputClass } from "./types";

type Rounding = "none" | "0.05" | "0.10" | "up";

const ROUNDING_LABEL: Record<Rounding, string> = {
  none: "Sin redondeo",
  "0.05": "Al múltiplo de $ 0,05",
  "0.10": "Al múltiplo de $ 0,10",
  up: "Al entero superior",
};

function marginOf(price: number, cost: number): number | null {
  if (price <= 0) return null;
  return ((price - cost) / price) * 100;
}

function buildPriceIndex(prices: ProductPrice[]) {
  const map = new Map<string, Map<string, number>>();
  for (const row of prices) {
    let byList = map.get(row.product_id);
    if (!byList) {
      byList = new Map();
      map.set(row.product_id, byList);
    }
    byList.set(row.price_list_id, toNumber(row.price_usd));
  }
  return map;
}

function resolvePrice(
  product: Product,
  list: PriceList,
  index: Map<string, Map<string, number>>,
): number {
  if (list.is_default) return toNumber(product.price_usd);
  return index.get(product.id)?.get(list.id) ?? toNumber(product.price_usd);
}

export function PricesTab({
  accountId,
  products,
  categories,
  priceLists,
  prices,
  rate,
  priceListsReady,
  onNewProduct,
  onChanged,
  onPriceListsChanged,
}: {
  accountId: string | null;
  products: Product[];
  categories: Category[];
  priceLists: PriceList[];
  prices: ProductPrice[];
  rate: number;
  priceListsReady: boolean;
  onNewProduct: () => void;
  onChanged: () => void;
  onPriceListsChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "all">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);

  const lists = useMemo(() => {
    const active = priceLists.filter((list) => list.active);
    return active.length > 0 ? active : priceLists;
  }, [priceLists]);

  const priceIndex = useMemo(() => buildPriceIndex(prices), [prices]);

  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((product) => product.kind !== "supply")
      .filter((product) => (status === "active" ? product.active : true))
      .filter((product) => {
        if (!term) return true;
        return (
          product.name.toLowerCase().includes(term) ||
          (product.sku ?? "").toLowerCase().includes(term) ||
          (product.barcode ?? "").toLowerCase().includes(term)
        );
      });
  }, [products, search, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const allSelected =
    rows.length > 0 && rows.every((row) => selected.has(row.id));

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) rows.forEach((row) => next.delete(row.id));
      else rows.forEach((row) => next.add(row.id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleActive(product: Product) {
    const supabase = createClient();
    await supabase
      .from("pos_products")
      .update({ active: !product.active })
      .eq("id", product.id);
    onChanged();
  }

  function exportCsv() {
    const header = [
      "Producto",
      "SKU",
      "Código de barras",
      "Categoría",
      "Costo USD",
      ...lists.map((list) => `${list.name} USD`),
      "Activo",
    ];
    const lines = filtered.map((product) => {
      const cost = toNumber(product.cost_usd);
      return [
        product.name,
        product.sku ?? "",
        product.barcode ?? "",
        categoriesById.get(product.category_id ?? "")?.name ?? "",
        cost.toFixed(2),
        ...lists.map((list) =>
          resolvePrice(product, list, priceIndex).toFixed(2),
        ),
        product.active ? "Sí" : "No",
      ];
    });
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [header, ...lines]
      .map((row) => row.map(escape).join(";"))
      .join("\r\n");

    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `precios-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-base font-bold text-slate-900">Precios</p>
          <p className="text-xs text-slate-500">
            Costo, precio y margen de cada producto en cada canal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title="Descargar precios en CSV"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
          </button>
          <PosButton
            variant="outline"
            onClick={() => setChannelsOpen(true)}
            disabled={!priceListsReady}
          >
            <Tag className="h-4 w-4" />
            Canales
          </PosButton>
          <PosButton onClick={() => setDialogOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" />
            Cambiar precios...
          </PosButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as "active" | "all");
            setPage(1);
          }}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 outline-none"
        >
          <option value="active">Activos</option>
          <option value="all">Todos</option>
        </select>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nombre o SKU..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>
        <button
          type="button"
          onClick={onNewProduct}
          title="Nuevo producto"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-[#4338ca] hover:bg-slate-50"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="px-6 py-16 text-center text-sm text-slate-500">
          No hay productos vendibles que coincidan.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-[#4338ca]"
                  />
                </th>
                <th className="px-4 py-2.5 font-semibold">Producto</th>
                <th className="px-4 py-2.5 text-right font-semibold">Costo</th>
                {lists.map((list) => (
                  <th
                    key={list.id}
                    className="px-3 py-2.5 text-right font-semibold"
                  >
                    <span className="inline-flex items-center gap-1">
                      {list.name}
                      {list.is_default ? (
                        <span className="rounded bg-indigo-50 px-1 py-0.5 text-[8px] font-bold text-[#4338ca]">
                          BASE
                        </span>
                      ) : null}
                    </span>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-semibold">Activo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((product) => {
                const cost = toNumber(product.cost_usd);
                const category = categoriesById.get(product.category_id ?? "");
                return (
                  <tr key={product.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(product.id)}
                        onChange={() => toggleOne(product.id)}
                        className="h-4 w-4 accent-[#4338ca]"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold uppercase text-slate-800">
                        {product.name}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {product.barcode ?? product.sku ?? "Sin código"}
                        {category ? ` · ${category.name.toUpperCase()}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-semibold text-slate-700">
                        {formatUsd(cost)}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {formatBs(usdToBs(cost, rate))}
                        <span className="block">Costo registrado</span>
                      </p>
                    </td>
                    {lists.map((list) => {
                      const price = resolvePrice(product, list, priceIndex);
                      const margin = marginOf(price, cost);
                      return (
                        <td key={list.id} className="px-3 py-3">
                          <PriceInput
                            accountId={accountId}
                            product={product}
                            list={list}
                            value={price}
                            onSaved={onChanged}
                          />
                          <p className="mt-0.5 text-right text-[10px] text-slate-400">
                            {margin == null
                              ? "Sin precio"
                              : `${margin.toFixed(2)} % margen`}
                          </p>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={product.active}
                          onClick={() => void toggleActive(product)}
                          className={`relative h-5 w-9 rounded-full transition-colors ${
                            product.active ? "bg-[#4338ca]" : "bg-slate-200"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                              product.active ? "left-[18px]" : "left-0.5"
                            }`}
                          />
                        </button>
                        <span className="w-12 text-[11px] text-slate-500">
                          {product.active ? "Activo" : "Inactivo"}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span>
              {(currentPage - 1) * pageSize + 1}–
              {Math.min(currentPage * pageSize, filtered.length)} de{" "}
              {filtered.length} resultados
            </span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} por pág.
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="px-2">
              {currentPage} de {pageCount}
            </span>
            <button
              type="button"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      ) : null}

      {dialogOpen ? (
        <PriceChangeDialog
          accountId={accountId}
          all={products}
          filtered={filtered}
          hasFilters={search.trim().length > 0 || status !== "active"}
          selected={products.filter((product) => selected.has(product.id))}
          lists={lists}
          prices={prices}
          onClose={() => setDialogOpen(false)}
          onApplied={() => {
            setDialogOpen(false);
            setSelected(new Set());
            onChanged();
          }}
        />
      ) : null}

      {channelsOpen ? (
        <ChannelsDialog
          accountId={accountId}
          priceLists={priceLists}
          onClose={() => setChannelsOpen(false)}
          onChanged={onPriceListsChanged}
        />
      ) : null}
    </section>
  );
}

function PriceInput({
  accountId,
  product,
  list,
  value,
  onSaved,
}: {
  accountId: string | null;
  product: Product;
  list: PriceList;
  value: number;
  onSaved: () => void;
}) {
  const [text, setText] = useState(() => value.toFixed(2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setText(value.toFixed(2));
  }, [value]);

  async function commit() {
    if (!accountId) return;
    const next = Math.max(round2(toNumber(text)), 0);
    setError(false);

    if (next === round2(value)) {
      setText(next.toFixed(2));
      return;
    }

    setSaving(true);
    const supabase = createClient();
    let saveError: { message: string } | null = null;

    if (list.is_default) {
      const result = await supabase
        .from("pos_products")
        .update({ price_usd: next })
        .eq("id", product.id);
      saveError = result.error;
    } else {
      const result = await supabase.from("pos_product_prices").upsert(
        {
          account_id: accountId,
          product_id: product.id,
          price_list_id: list.id,
          price_usd: next,
        },
        { onConflict: "product_id,price_list_id" },
      );
      saveError = result.error;
    }

    setSaving(false);

    if (saveError) {
      setError(true);
      setText(value.toFixed(2));
      return;
    }
    setText(next.toFixed(2));
    onSaved();
  }

  return (
    <div
      className={`ml-auto flex items-center gap-1 rounded-lg border px-2 py-1.5 ${
        error ? "border-red-300" : "border-slate-200"
      }`}
    >
      {saving ? (
        <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
      ) : (
        <span className="text-xs text-slate-400">$</span>
      )}
      <input
        value={text}
        inputMode="decimal"
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setText(value.toFixed(2));
            event.currentTarget.blur();
          }
        }}
        className="w-16 bg-transparent text-right text-sm font-semibold text-slate-800 outline-none"
      />
    </div>
  );
}

function PriceChangeDialog({
  accountId,
  all,
  filtered,
  hasFilters,
  selected,
  lists,
  prices,
  onClose,
  onApplied,
}: {
  accountId: string | null;
  all: Product[];
  filtered: Product[];
  hasFilters: boolean;
  selected: Product[];
  lists: PriceList[];
  prices: ProductPrice[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [scope, setScope] = useState<"filtered" | "selected" | "all">(
    selected.length > 0 ? "selected" : "filtered",
  );
  const [channelId, setChannelId] = useState(
    () => lists.find((list) => list.is_default)?.id ?? lists[0]?.id ?? "",
  );
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("-10");
  const [rounding, setRounding] = useState<Rounding>("none");
  const [preview, setPreview] = useState<
    { product: Product; before: number; after: number }[] | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceIndex = useMemo(() => buildPriceIndex(prices), [prices]);
  const channel =
    lists.find((list) => list.id === channelId) ?? lists[0] ?? null;

  const base = useMemo(() => {
    if (scope === "selected") return selected;
    if (scope === "all") return all;
    return filtered;
  }, [scope, selected, all, filtered]);

  function previewRows() {
    if (!channel) return;
    const amount = toNumber(value);
    const rows = base
      .filter((product) => product.kind !== "supply")
      .map((product) => {
        const before = resolvePrice(product, channel, priceIndex);
        const raw =
          kind === "percent" ? before * (1 + amount / 100) : before + amount;
        let after = Math.max(raw, 0);
        if (rounding === "0.05") after = Math.round(after / 0.05) * 0.05;
        if (rounding === "0.10") after = Math.round(after / 0.1) * 0.1;
        if (rounding === "up") after = Math.ceil(after);
        return { product, before, after: round2(Math.max(after, 0)) };
      })
      .filter((row) => row.after !== row.before);

    setPreview(rows);
    if (rows.length === 0) {
      setError("Ningún precio cambia con esos valores.");
    } else {
      setError(null);
    }
  }

  async function apply() {
    if (!accountId || !channel || !preview || preview.length === 0) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();

    for (const row of preview) {
      const result = channel.is_default
        ? await supabase
            .from("pos_products")
            .update({ price_usd: row.after })
            .eq("id", row.product.id)
        : await supabase.from("pos_product_prices").upsert(
            {
              account_id: accountId,
              product_id: row.product.id,
              price_list_id: channel.id,
              price_usd: row.after,
            },
            { onConflict: "product_id,price_list_id" },
          );

      if (result.error) {
        setSaving(false);
        setError(
          `Se aplicaron algunos precios. Falló "${row.product.name}": ${result.error.message}`,
        );
        return;
      }
    }

    setSaving(false);
    onApplied();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-xl font-black text-slate-900">Cambiar precios</h2>
            <p className="text-xs text-slate-500">
              Revise el antes y el después antes de aplicar.
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

        <div className="space-y-4 px-5 py-4">
          <div>
            <p className="text-sm font-bold text-slate-800">Qué precios cambian</p>
            <div className="mt-2 space-y-2">
              <ScopeOption
                checked={scope === "filtered"}
                onChange={() => {
                  setScope("filtered");
                  setPreview(null);
                }}
                title="Los filtros activos"
                subtitle={
                  hasFilters
                    ? `${filtered.length} productos coinciden con la búsqueda.`
                    : "No hay filtros: equivale a todo el catálogo."
                }
              />
              <ScopeOption
                checked={scope === "selected"}
                disabled={selected.length === 0}
                onChange={() => {
                  setScope("selected");
                  setPreview(null);
                }}
                title={`Los productos seleccionados (${selected.length})`}
                subtitle={
                  selected.length === 0
                    ? "Marca productos en la tabla para usar esta opción."
                    : "Solo cambia los productos marcados."
                }
              />
              <ScopeOption
                checked={scope === "all"}
                onChange={() => {
                  setScope("all");
                  setPreview(null);
                }}
                title="Todo el catálogo"
                subtitle="Todos los productos vendibles, activos o no."
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">Canal</span>
              <select
                value={channelId}
                onChange={(event) => {
                  setChannelId(event.target.value);
                  setPreview(null);
                }}
                className={inputClass}
              >
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                    {list.is_default ? " (base)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">
                Tipo de cambio
              </span>
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as "percent" | "fixed");
                  setPreview(null);
                }}
                className={inputClass}
              >
                <option value="percent">Porcentaje (%)</option>
                <option value="fixed">Monto fijo ($)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">Valor</span>
              <input
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setPreview(null);
                }}
                inputMode="decimal"
                className={inputClass}
              />
              <span className="text-[10px] text-slate-400">
                Usa un número negativo para bajar. Ej.: 10 sube 10 %, -5 baja
                5 %.
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">
                Redondeo del precio nuevo ($)
              </span>
              <select
                value={rounding}
                onChange={(event) => {
                  setRounding(event.target.value as Rounding);
                  setPreview(null);
                }}
                className={inputClass}
              >
                {(Object.keys(ROUNDING_LABEL) as Rounding[]).map((key) => (
                  <option key={key} value={key}>
                    {ROUNDING_LABEL[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {preview ? (
            preview.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                Ningún precio cambia con esos valores.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2 text-right">Antes</th>
                      <th className="px-3 py-2 text-right">Después</th>
                      <th className="px-3 py-2 text-right">Margen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((row) => {
                      const cost = toNumber(row.product.cost_usd);
                      const margin = marginOf(row.after, cost);
                      return (
                        <tr key={row.product.id}>
                          <td className="px-3 py-2 font-medium text-slate-700">
                            {row.product.name}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500">
                            {formatUsd(row.before)}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">
                            {formatUsd(row.after)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500">
                            {margin == null ? "—" : `${margin.toFixed(1)} %`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : null}

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-[#4338ca] hover:bg-slate-50"
          >
            Cancelar
          </button>
          <PosButton variant="outline" onClick={previewRows}>
            Vista previa
          </PosButton>
          <PosButton
            onClick={() => void apply()}
            disabled={!preview || preview.length === 0 || saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Aplicar
          </PosButton>
        </div>
      </div>
    </div>
  );
}

function ChannelsDialog({
  accountId,
  priceLists,
  onClose,
  onChanged,
}: {
  accountId: string | null;
  priceLists: PriceList[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addChannel() {
    if (!accountId || newName.trim().length < 2) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: dbError } = await supabase.from("pos_price_lists").insert({
      account_id: accountId,
      name: newName.trim(),
      is_default: false,
      active: true,
    });
    setSaving(false);
    if (dbError) {
      setError(
        dbError.code === "23505"
          ? "Ya existe un canal con ese nombre."
          : dbError.message,
      );
      return;
    }
    setNewName("");
    onChanged();
  }

  async function toggleActive(list: PriceList) {
    if (list.is_default) return;
    const supabase = createClient();
    await supabase
      .from("pos_price_lists")
      .update({ active: !list.active })
      .eq("id", list.id);
    onChanged();
  }

  async function remove(list: PriceList) {
    if (list.is_default) return;
    if (!window.confirm(`¿Eliminar el canal "${list.name}"?`)) return;
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("pos_price_lists")
      .delete()
      .eq("id", list.id);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    onChanged();
  }

  async function rename(list: PriceList, name: string) {
    const next = name.trim();
    if (!next || next === list.name) return;
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("pos_price_lists")
      .update({ name: next })
      .eq("id", list.id);
    if (dbError) {
      setError(
        dbError.code === "23505"
          ? "Ya existe un canal con ese nombre."
          : dbError.message,
      );
      return;
    }
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              Canales de precio
            </h2>
            <p className="text-xs text-slate-500">
              Un precio distinto para mayoristas, delivery o mostrador.
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
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addChannel();
              }}
              placeholder="Nuevo canal (Mayorista, Delivery...)"
              className={inputClass}
            />
            <PosButton
              onClick={() => void addChannel()}
              disabled={saving || newName.trim().length < 2}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Agregar
            </PosButton>
          </div>

          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {priceLists.map((list) => (
              <div key={list.id} className="flex items-center gap-2 px-3 py-2.5">
                <input
                  key={`${list.id}-${list.name}`}
                  defaultValue={list.name}
                  onBlur={(event) => void rename(list, event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 text-sm font-semibold text-slate-800 outline-none hover:border-slate-200 focus:border-[#4338ca]"
                />
                {list.is_default ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-[#4338ca]">
                    <Star className="h-3 w-3" />
                    Predeterminado
                  </span>
                ) : null}
                <button
                  type="button"
                  role="switch"
                  aria-checked={list.active}
                  disabled={list.is_default}
                  onClick={() => void toggleActive(list)}
                  className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${
                    list.active ? "bg-[#4338ca]" : "bg-slate-200"
                  }`}
                  title={list.active ? "Activo" : "Inactivo"}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      list.active ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => void remove(list)}
                  disabled={list.is_default}
                  title="Eliminar canal"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <PosButton onClick={onClose}>Listo</PosButton>
        </div>
      </div>
    </div>
  );
}

function ScopeOption({
  checked,
  disabled,
  onChange,
  title,
  subtitle,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${
        checked
          ? "border-[#4338ca] bg-indigo-50/50"
          : "border-slate-200 bg-white"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input
        type="radio"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 accent-[#4338ca]"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-800">
          {title}
        </span>
        <span className="block text-[11px] text-slate-500">{subtitle}</span>
      </span>
    </label>
  );
}
