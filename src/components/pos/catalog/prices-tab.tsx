"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Info,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { PosButton } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, round2, toNumber, usdToBs } from "@/lib/pos/money";
import type { Category, Product } from "./types";
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

export function PricesTab({
  accountId,
  products,
  categories,
  rate,
  onNewProduct,
  onChanged,
}: {
  accountId: string | null;
  products: Product[];
  categories: Category[];
  rate: number;
  onNewProduct: () => void;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "all">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

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
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

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
      "Precio USD",
      "Margen %",
      "Activo",
    ];
    const lines = filtered.map((product) => {
      const cost = toNumber(product.cost_usd);
      const price = toNumber(product.price_usd);
      const margin = marginOf(price, cost);
      return [
        product.name,
        product.sku ?? "",
        product.barcode ?? "",
        categoriesById.get(product.category_id ?? "")?.name ?? "",
        cost.toFixed(2),
        price.toFixed(2),
        margin == null ? "" : margin.toFixed(2),
        product.active ? "Sí" : "No",
      ];
    });
    const escape = (value: string) =>
      `"${value.replaceAll('"', '""')}"`;
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
            Costo, precio y margen de cada producto.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title="Descargar precios en CSV"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
          </button>
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
                <th className="px-4 py-2.5 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Precios por canal
                    <Info
                      className="h-3 w-3 text-slate-400"
                      aria-label="El POS usa el canal Principal"
                    />
                  </span>
                </th>
                <th className="px-4 py-2.5 text-right font-semibold">Margen</th>
                <th className="px-4 py-2.5 text-right font-semibold">Activo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((product) => {
                const cost = toNumber(product.cost_usd);
                const price = toNumber(product.price_usd);
                const margin = marginOf(price, cost);
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
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-semibold text-slate-400">
                          Principal
                        </span>
                        <PriceInput
                          product={product}
                          onSaved={onChanged}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {margin == null ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span
                          className={`font-semibold ${
                            margin >= 0 ? "text-slate-700" : "text-red-600"
                          }`}
                        >
                          {margin.toFixed(2)} %
                        </span>
                      )}
                    </td>
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
          onClose={() => setDialogOpen(false)}
          onApplied={() => {
            setDialogOpen(false);
            setSelected(new Set());
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function PriceInput({
  product,
  onSaved,
}: {
  product: Product;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(() => toNumber(product.price_usd).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setValue(toNumber(product.price_usd).toFixed(2));
  }, [product.price_usd]);

  async function commit() {
    const next = Math.max(round2(toNumber(value)), 0);
    setError(false);

    if (next === round2(toNumber(product.price_usd))) {
      setValue(next.toFixed(2));
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("pos_products")
      .update({ price_usd: next })
      .eq("id", product.id);
    setSaving(false);

    if (updateError) {
      setError(true);
      setValue(toNumber(product.price_usd).toFixed(2));
      return;
    }
    setValue(next.toFixed(2));
    onSaved();
  }

  return (
    <div
      className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 ${
        error ? "border-red-300" : "border-slate-200"
      }`}
    >
      {saving ? (
        <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
      ) : (
        <span className="text-xs text-slate-400">$</span>
      )}
      <input
        value={value}
        inputMode="decimal"
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setValue(toNumber(product.price_usd).toFixed(2));
            event.currentTarget.blur();
          }
        }}
        className="w-20 bg-transparent text-right text-sm font-semibold text-slate-800 outline-none"
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
  onClose,
  onApplied,
}: {
  accountId: string | null;
  all: Product[];
  filtered: Product[];
  hasFilters: boolean;
  selected: Product[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [scope, setScope] = useState<"filtered" | "selected" | "all">(
    selected.length > 0 ? "selected" : "filtered",
  );
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("-10");
  const [rounding, setRounding] = useState<Rounding>("none");
  const [preview, setPreview] = useState<
    { product: Product; before: number; after: number }[] | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = useMemo(() => {
    if (scope === "selected") return selected;
    if (scope === "all") return all;
    return filtered;
  }, [scope, selected, all, filtered]);

  function calculate(): number {
    const amount = toNumber(value);
    if (amount === 0) return 0;
    if (kind === "percent") return amount;
    return amount;
  }

  function previewRows() {
    const amount = calculate();
    const rows = base
      .filter((product) => product.kind !== "supply")
      .map((product) => {
        const before = toNumber(product.price_usd);
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
    if (!accountId || !preview || preview.length === 0) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();

    for (const row of preview) {
      const { error: updateError } = await supabase
        .from("pos_products")
        .update({ price_usd: row.after })
        .eq("id", row.product.id);
      if (updateError) {
        setSaving(false);
        setError(
          `Se aplicaron algunos precios. Falló "${row.product.name}": ${updateError.message}`,
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
            <label className="flex flex-col gap-1 sm:col-span-2">
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
