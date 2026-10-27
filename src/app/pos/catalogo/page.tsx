"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Package,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import { PosButton } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, toNumber, usdToBs } from "@/lib/pos/money";
import { DiscountsTab } from "@/components/pos/catalog/discounts-tab";
import { PricesTab } from "@/components/pos/catalog/prices-tab";
import { SurchargesTab } from "@/components/pos/catalog/surcharges-tab";
import { VariantDialog } from "@/components/pos/catalog/variant-dialog";
import {
  UnitSelect,
  unitShort,
} from "@/components/pos/catalog/unit-select";
import {
  CATEGORY_COLORS,
  KIND_LABEL,
  KIND_SHORT,
  inputClass,
  type Category,
  type Discount,
  type Kind,
  type PriceList,
  type Product,
  type ProductPrice,
  type Surcharge,
} from "@/components/pos/catalog/types";

type Tab = "productos" | "precios" | "categorias" | "descuentos" | "recargos";

const TABS: { key: Tab; label: string }[] = [
  { key: "productos", label: "Productos" },
  { key: "precios", label: "Precios" },
  { key: "categorias", label: "Categorías" },
  { key: "descuentos", label: "Descuentos" },
  { key: "recargos", label: "Recargos" },
];

const PAGE_SIZE = 50;

export default function CatalogoPage() {
  const { accountId } = useAuth();
  const { rate } = usePosRate();

  const [tab, setTab] = useState<Tab>("productos");
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<Product | null>(null);
  const [formKind, setFormKind] = useState<Kind>("product");

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [surcharges, setSurcharges] = useState<Surcharge[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [prices, setPrices] = useState<ProductPrice[]>([]);
  const [priceListsReady, setPriceListsReady] = useState(false);
  const [missingMigrations, setMissingMigrations] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryEditing, setCategoryEditing] = useState<Category | null>(null);
  const [variantProduct, setVariantProduct] = useState<Product | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);
    setLoadError(null);
    const missing: string[] = [];

    const PRODUCT_FULL =
      "id, name, sku, barcode, description, kind, unit, cost_usd, price_usd, stock, min_stock, taxable, track_inventory, active, category_id, parent_product_id, is_parent, variant_label";
    const PRODUCT_BASE =
      "id, name, sku, kind, unit, cost_usd, price_usd, stock, min_stock, taxable, active, category_id";

    let productsData: Product[] = [];
    const firstProducts = await supabase
      .from("pos_products")
      .select(PRODUCT_FULL)
      .eq("account_id", accountId)
      .order("name");

    if (firstProducts.error) {
      const fallback = await supabase
        .from("pos_products")
        .select(PRODUCT_BASE)
        .eq("account_id", accountId)
        .order("name");
      if (fallback.error) {
        productsData = [];
        setLoadError(fallback.error.message);
      } else {
        productsData = (fallback.data ?? []).map((row) => ({
          ...row,
          barcode: null,
          description: null,
          track_inventory: true,
          parent_product_id: null,
          is_parent: false,
          variant_label: null,
        })) as Product[];
        const code = firstProducts.error.message.includes(
          "parent_product_id",
        )
          ? "097"
          : "089";
        if (!missing.includes(code)) missing.push(code);
      }
    } else {
      productsData = (firstProducts.data ?? []) as Product[];
    }

    let categoriesData: Category[] = [];
    const firstCategories = await supabase
      .from("pos_categories")
      .select("id, name, color, active")
      .eq("account_id", accountId)
      .order("name");

    if (firstCategories.error) {
      const fallback = await supabase
        .from("pos_categories")
        .select("id, name")
        .eq("account_id", accountId)
        .order("name");
      if (!fallback.error) {
        categoriesData = (fallback.data ?? []).map((row) => ({
          ...row,
          color: null,
          active: true,
        })) as Category[];
        if (!missing.includes("089")) missing.push("089");
      }
    } else {
      categoriesData = (firstCategories.data ?? []) as Category[];
    }

    const [discountsRes, surchargesRes, listsRes, pricesRes] =
      await Promise.all([
        supabase
          .from("pos_discounts")
          .select(
            "id, name, code, kind, value, max_uses, used_count, valid_from, valid_to, active",
          )
          .eq("account_id", accountId)
          .order("created_at", { ascending: false }),
        supabase
          .from("pos_surcharges")
          .select("id, name, kind, value, charge_customer, active")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false }),
        supabase
          .from("pos_price_lists")
          .select("id, name, is_default, active")
          .eq("account_id", accountId)
          .order("is_default", { ascending: false })
          .order("name"),
        supabase
          .from("pos_product_prices")
          .select("product_id, price_list_id, price_usd")
          .eq("account_id", accountId),
      ]);

    if (discountsRes.error || surchargesRes.error) {
      missing.push("090");
    }

    if (listsRes.error) {
      missing.push("092");
      setPriceListsReady(false);
      setPriceLists([
        { id: "principal", name: "Principal", is_default: true, active: true },
      ]);
      setPrices([]);
    } else {
      const lists = (listsRes.data ?? []) as PriceList[];
      setPriceListsReady(true);
      setPriceLists(
        lists.length > 0
          ? lists
          : [
              {
                id: "principal",
                name: "Principal",
                is_default: true,
                active: true,
              },
            ],
      );
      setPrices((pricesRes.data ?? []) as ProductPrice[]);
      if (lists.length === 0) missing.push("092");
    }

    setProducts(productsData);
    setCategories(categoriesData);
    setDiscounts((discountsRes.data ?? []) as Discount[]);
    setSurcharges((surchargesRes.data ?? []) as Surcharge[]);
    setMissingMigrations([...new Set(missing)]);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      if (product.parent_product_id) return false;
      if (statusFilter === "active" && !product.active) return false;
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        (product.sku ?? "").toLowerCase().includes(term) ||
        (product.barcode ?? "").toLowerCase().includes(term)
      );
    });
  }, [products, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const allSelected = pageRows.length > 0 && pageRows.every((p) => selected.has(p.id));

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) {
        pageRows.forEach((product) => next.delete(product.id));
      } else {
        pageRows.forEach((product) => next.add(product.id));
      }
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

  async function deactivate(ids: string[]) {
    if (!accountId || ids.length === 0) return;
    const supabase = createClient();
    const childIds = products
      .filter((product) => ids.includes(product.parent_product_id ?? ""))
      .map((product) => product.id);
    await supabase
      .from("pos_products")
      .update({ active: false })
      .in("id", [...ids, ...childIds]);
    setSelected(new Set());
    void load();
  }

  function openCreate(kind: Kind) {
    setEditing(null);
    setFormKind(kind);
    setView("form");
  }

  function openEdit(product: Product) {
    setEditing(product);
    setFormKind(product.kind);
    setView("form");
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-[#4338ca]">
            <Tag className="h-4 w-4" />
          </span>
          <h1 className="text-lg font-black tracking-tight text-slate-900">
            Catálogo
          </h1>
        </div>
        <div className="flex flex-wrap gap-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setTab(item.key);
                setView("list");
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                tab === item.key
                  ? "bg-indigo-50 text-[#4338ca]"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loadError ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <p className="font-bold">No se pudo cargar el catálogo</p>
          <p className="mt-0.5">{loadError}</p>
        </div>
      ) : null}

      {missingMigrations.length > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <p className="font-bold">Falta aplicar una migración en Supabase</p>
          <p className="mt-0.5">
            {missingMigrations.includes("089")
              ? "La 089 agrega color a las categorías y código de barras a los productos. "
              : ""}
            {missingMigrations.includes("090")
              ? "La 090 agrega descuentos, recargos y el cobro con código. "
              : ""}
            {missingMigrations.includes("092")
              ? "La 092 agrega los canales de precio; hasta entonces solo existe Principal. "
              : ""}
            {missingMigrations.includes("097")
              ? "La 097 agrega las variantes de producto. "
              : ""}
            Mientras tanto, el catálogo funciona con los campos anteriores.
          </p>
        </div>
      ) : null}

      {tab === "productos" && view === "list" ? (
        <section className="rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <p className="text-base font-bold text-slate-900">Productos</p>
              <p className="text-xs text-slate-500">
                Todo lo que vendes, en un solo listado.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selected.size > 0 ? (
                <PosButton
                  variant="outline"
                  onClick={() => void deactivate([...selected])}
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar ({selected.size})
                </PosButton>
              ) : null}
              <PosButton onClick={() => openCreate("product")}>
                <Plus className="h-4 w-4" />
                Nuevo producto
              </PosButton>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as "active" | "all");
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
                placeholder="Buscar por nombre, SKU o código..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-[#4338ca]" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Package className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-bold text-slate-800">
                {products.length === 0
                  ? "Todavía no hay productos"
                  : "Sin resultados"}
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                {products.length === 0
                  ? "Empieza por lo que quieres crear: cada tipo pide solo lo que necesita."
                  : "Prueba con otro nombre o código."}
              </p>
              {products.length === 0 ? (
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <PosButton onClick={() => openCreate("product")}>
                    Producto para vender
                  </PosButton>
                  <PosButton variant="outline" onClick={() => openCreate("supply")}>
                    Insumo
                  </PosButton>
                  <PosButton variant="outline" onClick={() => openCreate("service")}>
                    Servicio
                  </PosButton>
                </div>
              ) : null}
            </div>
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
                    <th className="px-4 py-2.5 font-semibold">Nombre</th>
                    <th className="px-4 py-2.5 font-semibold">SKU</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Costo</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Margen</th>
                    <th className="px-4 py-2.5 font-semibold">Categoría</th>
                    <th className="px-4 py-2.5 font-semibold">Tipo</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Existencia</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Precio</th>
                    <th className="px-4 py-2.5 font-semibold">Estado</th>
                    <th className="w-36 px-4 py-2.5 text-right font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((product) => {
                    const cost = toNumber(product.cost_usd);
                    const price = toNumber(product.price_usd);
                    const margin =
                      price > 0 ? ((price - cost) / price) * 100 : 0;
                    const category = categoriesById.get(product.category_id ?? "");
                    const childVariants = products.filter(
                      (row) => row.parent_product_id === product.id,
                    );
                    const variantCount = childVariants.length;
                    const minVariantPrice = childVariants.reduce<number | null>(
                      (min, row) => {
                        const value = toNumber(row.price_usd);
                        if (value <= 0) return min;
                        return min == null || value < min ? value : min;
                      },
                      null,
                    );
                    return (
                      <tr
                        key={product.id}
                        className="cursor-pointer hover:bg-slate-50/60"
                        onClick={() => openEdit(product)}
                      >
                        <td
                          className="px-4 py-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(product.id)}
                            onChange={() => toggleOne(product.id)}
                            className="h-4 w-4 accent-[#4338ca]"
                          />
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-800">
                          {product.name}
                          {variantCount > 0 ? (
                            <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-[#4338ca]">
                              {variantCount} variantes
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {product.sku ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          {product.is_parent || product.kind === "service"
                            ? "—"
                            : formatUsd(cost)}
                          {product.is_parent || product.kind === "service" ? null : (
                            <span className="block text-[10px] text-slate-400">
                              {formatBs(usdToBs(cost, rate))}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          {product.is_parent ||
                          product.kind === "service" ||
                          price <= 0
                            ? "—"
                            : `${margin.toFixed(1)} %`}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {category ? (
                            <span className="inline-flex items-center gap-1.5">
                              {category.color ? (
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: category.color }}
                                />
                              ) : null}
                              {category.name}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            {product.is_parent
                              ? "Variantes"
                              : KIND_SHORT[product.kind]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          {product.is_parent ||
                          !product.track_inventory ||
                          product.kind === "service"
                            ? "—"
                            : `${toNumber(product.stock)} ${product.unit}`}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">
                          {product.is_parent ? (
                            minVariantPrice != null ? (
                              <>
                                Desde {formatUsd(minVariantPrice)}
                                <span className="block text-[10px] font-normal text-slate-400">
                                  {formatBs(usdToBs(minVariantPrice, rate))}
                                </span>
                              </>
                            ) : (
                              "—"
                            )
                          ) : (
                            <>
                              {formatUsd(price)}
                              <span className="block text-[10px] font-normal text-slate-400">
                                {formatBs(usdToBs(price, rate))}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              product.active
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {product.active ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                        <td
                          className="px-4 py-3 text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setVariantProduct(product)}
                              className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              Variantes
                            </button>
                            <button
                              type="button"
                              onClick={() => void deactivate([product.id])}
                              className="text-[11px] font-bold text-[#4338ca] hover:underline"
                            >
                              Eliminar
                            </button>
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
                  {(currentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(currentPage * PAGE_SIZE, filtered.length)} de{" "}
                  {filtered.length}
                </span>
                <span className="text-slate-400">· 50 por página</span>
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
        </section>
      ) : null}

      {tab === "productos" && view === "form" ? (
        <ProductForm
          accountId={accountId}
          categories={categories}
          product={editing}
          initialKind={formKind}
          rate={rate}
          onCancel={() => setView("list")}
          onSaved={() => {
            setView("list");
            void load();
          }}
          onCreateCategory={() => {
            setCategoryEditing(null);
            setCategoryOpen(true);
          }}
        />
      ) : null}

      {tab === "categorias" ? (
        <CategoryList
          categories={categories}
          products={products}
          onNew={() => {
            setCategoryEditing(null);
            setCategoryOpen(true);
          }}
          onEdit={(category) => {
            setCategoryEditing(category);
            setCategoryOpen(true);
          }}
        />
      ) : null}

      {tab === "precios" ? (
        <PricesTab
          accountId={accountId}
          products={products}
          categories={categories}
          priceLists={priceLists}
          prices={prices}
          rate={rate}
          priceListsReady={priceListsReady}
          onNewProduct={() => {
            setTab("productos");
            openCreate("product");
          }}
          onChanged={() => void load()}
          onPriceListsChanged={() => void load()}
        />
      ) : null}

      {tab === "descuentos" ? (
        <DiscountsTab
          accountId={accountId}
          discounts={discounts}
          onChanged={() => void load()}
        />
      ) : null}

      {tab === "recargos" ? (
        <SurchargesTab
          accountId={accountId}
          surcharges={surcharges}
          onChanged={() => void load()}
        />
      ) : null}

      {categoryOpen ? (
        <CategoryDialog
          accountId={accountId}
          category={categoryEditing}
          onClose={() => setCategoryOpen(false)}
          onSaved={() => {
            setCategoryOpen(false);
            void load();
          }}
        />
      ) : null}

      {variantProduct ? (
        <VariantDialog
          product={variantProduct}
          onClose={() => setVariantProduct(null)}
          onChanged={() => {
            void load();
            setVariantProduct((current) =>
              current ? { ...current, is_parent: true } : current,
            );
          }}
        />
      ) : null}
    </div>
  );
}

function ProductForm({
  accountId,
  categories,
  product,
  initialKind,
  rate,
  onCancel,
  onSaved,
  onCreateCategory,
}: {
  accountId: string | null;
  categories: Category[];
  product: Product | null;
  initialKind: Kind;
  rate: number;
  onCancel: () => void;
  onSaved: () => void;
  onCreateCategory: () => void;
}) {
  const [kind, setKind] = useState<Kind>(product?.kind ?? initialKind);
  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(
    product ? String(toNumber(product.price_usd)) : "",
  );
  const [categoryId, setCategoryId] = useState(product?.category_id ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "unidad");
  const [trackInventory, setTrackInventory] = useState(
    product?.track_inventory ?? true,
  );
  const [minStock, setMinStock] = useState(
    product ? String(toNumber(product.min_stock)) : "0",
  );
  const [stockInitial, setStockInitial] = useState("0");
  const [cost, setCost] = useState(
    product ? String(toNumber(product.cost_usd)) : "",
  );
  const [sku, setSku] = useState(product?.sku ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [taxable, setTaxable] = useState(product?.taxable ?? true);
  const [active, setActive] = useState(product?.active ?? true);

  const [openInventory, setOpenInventory] = useState(true);
  const [openCodes, setOpenCodes] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingName = name.trim().length < 2;
  const missingPrice = kind !== "supply" && toNumber(price) <= 0;
  const canSave = !missingName && !missingPrice;

  const previewStock = product
    ? toNumber(product.stock)
    : toNumber(stockInitial);
  const previewCost = toNumber(cost);
  const previewPrice = kind === "supply" ? 0 : toNumber(price);
  const previewMargin =
    previewPrice > 0
      ? ((previewPrice - previewCost) / previewPrice) * 100
      : null;
  const previewCategory = categories.find(
    (category) => category.id === categoryId,
  );
  const previewColor = previewCategory?.color ?? "#4338ca";
  const previewInitials =
    (name.trim() || "?").charAt(0).toUpperCase() +
    (name.trim() || "?").slice(1, 2).toLowerCase();

  async function save() {
    if (!accountId) return;
    if (!canSave) return;

    setSaving(true);
    setError(null);
    const supabase = createClient();

    const payload = {
      name: name.trim(),
      kind,
      unit: unit.trim() || "unidad",
      category_id: categoryId || null,
      cost_usd: toNumber(cost),
      price_usd: kind === "supply" ? 0 : toNumber(price),
      min_stock: toNumber(minStock),
      taxable,
      active,
      track_inventory: trackInventory,
      sku: sku.trim() || null,
      barcode: barcode.trim() || null,
      description: description.trim() || null,
    };

    if (product) {
      const { error: updateError } = await supabase
        .from("pos_products")
        .update(payload)
        .eq("id", product.id);
      setSaving(false);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      onSaved();
      return;
    }

    const { data: created, error: insertError } = await supabase
      .from("pos_products")
      .insert({
        account_id: accountId,
        ...payload,
        stock: 0,
      })
      .select("id")
      .single();

    if (insertError || !created) {
      setSaving(false);
      setError(insertError?.message ?? "No se pudo crear el producto");
      return;
    }

    // La existencia inicial entra como un conteo de inventario.
    if (kind !== "service" && toNumber(stockInitial) > 0) {
      const { error: stockError } = await supabase.rpc("pos_create_adjustment", {
        p_payload: {
          type: "count",
          note: "Stock inicial",
          items: [
            { product_id: created.id, value: toNumber(stockInitial) },
          ],
        },
      });
      if (stockError) {
        setError(`Producto creado, pero no el stock: ${stockError.message}`);
        setSaving(false);
        onSaved();
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-sm text-slate-500">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 font-semibold hover:text-[#4338ca]"
        >
          <ArrowLeft className="h-4 w-4" />
          Productos
        </button>
      </div>

      <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <h2 className="text-xl font-black text-slate-900">
            {product ? "Editar producto" : "Nuevo producto"}
          </h2>
          <p className="text-sm text-slate-500">
            ¿Qué vas a agregar? Elige uno y te pedimos solo lo que necesita.
          </p>

          {product?.is_parent ? (
            <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              Este producto es el contenedor de sus variantes. El precio y el
              stock se manejan en cada variante desde la tabla Productos.
            </div>
          ) : null}

          <div className="mt-4 inline-flex rounded-xl bg-slate-100 p-1">
            {(["product", "supply", "service"] as Kind[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                  kind === value
                    ? "bg-white text-[#4338ca] shadow-sm"
                    : "text-slate-500"
                }`}
              >
                {KIND_LABEL[value]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {kind === "product"
              ? "Un producto con su precio: lo vendes tal cual lo compras."
              : kind === "supply"
                ? "Algo que compras y usas en recetas. No se vende ni lleva precio."
                : "Se cobra pero no tiene existencias: corte, reparación, envío."}
          </p>

          <div className="mt-6">
            <p className="text-sm font-bold text-slate-800">
              {kind === "supply" ? "Lo que compras" : "Lo que ve el cliente"}
            </p>

            <label className="mt-3 flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">Nombre *</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={inputClass}
              />
            </label>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {kind !== "supply" ? (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-700">
                    Precio *
                  </span>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="text-sm text-slate-400">$</span>
                    <input
                      value={price}
                      onChange={(event) => setPrice(event.target.value)}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="w-full bg-transparent text-right text-sm outline-none"
                    />
                  </div>
                  {toNumber(price) > 0 ? (
                    <span className="text-[10px] text-slate-400">
                      ≈ {formatBs(usdToBs(toNumber(price), rate))}
                    </span>
                  ) : null}
                </label>
              ) : null}

              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Categoría
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={categoryId}
                    onChange={(event) => setCategoryId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">— Sin categoría —</option>
                    {categories
                      .filter((category) => category.active)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={onCreateCategory}
                    className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] font-bold text-[#4338ca] hover:bg-slate-50"
                  >
                    + Nueva
                  </button>
                </div>
              </label>
            </div>
          </div>

          {kind !== "service" ? (
            <Collapsible
              title="Unidad e inventario"
              subtitle={`${unitShort(unit)} · ${trackInventory ? "controla inventario" : "sin control"}`}
              open={openInventory}
              onToggle={() => setOpenInventory((value) => !value)}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs font-bold text-slate-700">
                    Unidad *
                  </span>
                  <UnitSelect value={unit} onChange={setUnit} />
                </div>

                <div className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={trackInventory}
                    onClick={() => setTrackInventory((value) => !value)}
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      trackInventory ? "bg-[#4338ca]" : "bg-slate-200"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                        trackInventory ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                  Controlar inventario
                </div>

                {trackInventory ? (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-slate-700">
                        Stock mínimo
                      </span>
                      <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                        <input
                          value={minStock}
                          onChange={(event) => setMinStock(event.target.value)}
                          inputMode="decimal"
                          className="w-full bg-transparent text-sm outline-none"
                        />
                        <span className="text-sm text-slate-400">
                          {unitShort(unit)}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        Aviso cuando quede por debajo
                      </span>
                    </label>

                    <div className="hidden sm:block" aria-hidden="true" />

                    {product ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-slate-700">
                          Existencia actual
                        </span>
                        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          {toNumber(product.stock)} {unitShort(unit)}
                        </p>
                        <span className="text-[10px] text-slate-400">
                          Se cambia con compras o ajustes
                        </span>
                      </div>
                    ) : (
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-slate-700">
                          Stock inicial
                        </span>
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                          <input
                            value={stockInitial}
                            onChange={(event) =>
                              setStockInitial(event.target.value)
                            }
                            inputMode="decimal"
                            className="w-full bg-transparent text-sm outline-none"
                          />
                          <span className="text-sm text-slate-400">
                            {unitShort(unit)}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          Lo que tienes hoy. Entra como un conteo de
                          inventario.
                        </span>
                      </label>
                    )}

                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-slate-700">
                        Costo unitario
                      </span>
                      <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                        <span className="text-sm text-slate-400">$</span>
                        <input
                          value={cost}
                          onChange={(event) => setCost(event.target.value)}
                          inputMode="decimal"
                          placeholder="0,00"
                          className="w-full bg-transparent text-right text-sm outline-none"
                        />
                      </div>
                      <span className="text-[10px] text-slate-400">
                        ≈ {formatBs(usdToBs(toNumber(cost), rate))} · Lo que
                        pagaste por cada {unitShort(unit)}. Hace falta si cargas
                        stock.
                      </span>
                    </label>
                  </>
                ) : null}
              </div>
            </Collapsible>
          ) : null}

          <Collapsible
            title="Códigos y detalles"
            subtitle="SKU, código de barras, descripción e IVA"
            open={openCodes}
            onToggle={() => setOpenCodes((value) => !value)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">SKU</span>
                <input
                  value={sku}
                  onChange={(event) => setSku(event.target.value)}
                  className={inputClass}
                />
                <span className="text-[10px] text-slate-400">
                  Opcional, único por comercio
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Código de barras
                </span>
                <input
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs font-bold text-slate-700">
                  Descripción
                </span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={2}
                  placeholder="Ej.: Camisa de algodón talla M"
                  className={inputClass}
                />
                <span className="text-[10px] text-slate-400">
                  Opcional. Se muestra al vender.
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">IVA</span>
                <select
                  value={taxable ? "true" : "false"}
                  onChange={(event) =>
                    setTaxable(event.target.value === "true")
                  }
                  className={inputClass}
                >
                  <option value="true">
                    Predeterminado del comercio (16 %)
                  </option>
                  <option value="false">Exento de IVA</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(event) => setActive(event.target.checked)}
                  className="h-4 w-4 accent-[#4338ca]"
                />
                Activo en el POS
              </label>
            </div>
          </Collapsible>
        </div>

        {/* Vista previa */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="mx-auto w-full max-w-52 rounded-xl border border-slate-200 bg-white p-3">
              <div
                className="relative flex h-24 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${previewColor}14` }}
              >
                <span
                  className="text-2xl font-black tracking-tight"
                  style={{ color: previewColor }}
                >
                  {previewInitials}
                </span>
                <span className="absolute bottom-2 left-2 rounded bg-white/95 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 shadow-sm">
                  {kind === "service" || !trackInventory
                    ? "Sin inventario"
                    : `${previewStock} ${unitShort(unit)}`}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 min-h-8 text-xs font-semibold text-slate-700">
                {name.trim() || "Nombre del producto"}
              </p>
              <p className="text-lg font-black text-slate-900">
                {kind === "supply"
                  ? "—"
                  : previewPrice > 0
                    ? formatUsd(previewPrice)
                    : "Sin precio"}
              </p>
              {kind !== "supply" && previewPrice > 0 ? (
                <p className="text-[10px] text-slate-400">
                  {formatBs(usdToBs(previewPrice, rate))}
                </p>
              ) : null}
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400">
              Así se verá en el POS
            </p>

            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-bold text-slate-700">
                Al crearlo
              </p>
              <div className="mt-2 space-y-1.5 text-[11px] text-slate-500">
                {missingPrice ? (
                  <p className="flex items-start gap-1.5">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    Falta el precio: sin él no se crea.
                  </p>
                ) : kind === "supply" ? (
                  <p className="flex items-start gap-1.5">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    Es un insumo: no se vende ni aparece en el POS.
                  </p>
                ) : previewPrice > 0 ? (
                  <p className="flex items-start gap-1.5">
                    <Tag className="mt-0.5 h-3 w-3 shrink-0" />
                    Se vende a {formatUsd(previewPrice)} (
                    {formatBs(usdToBs(previewPrice, rate))}), antes de IVA.
                  </p>
                ) : null}

                {kind === "service" ? (
                  <p className="flex items-start gap-1.5">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    Se cobra sin llevar inventario.
                  </p>
                ) : trackInventory ? (
                  <p className="flex items-start gap-1.5">
                    <Package className="mt-0.5 h-3 w-3 shrink-0" />
                    {product
                      ? `Tiene ${toNumber(product.stock)} ${unitShort(
                          unit,
                        )} en existencia.`
                      : previewStock > 0
                        ? `Entra con ${previewStock} ${unitShort(
                            unit,
                          )} a ${formatUsd(previewCost)} c/u por un conteo de inventario.`
                        : "Sin existencia inicial: entra luego con una compra o un ajuste."}
                  </p>
                ) : (
                  <p className="flex items-start gap-1.5">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    No controla inventario.
                  </p>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                <span className="text-[11px] text-slate-500">Margen</span>
                <span className="text-lg font-black text-slate-900">
                  {previewMargin == null
                    ? "—"
                    : `${previewMargin.toFixed(1)} %`}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white/95 px-5 py-3 backdrop-blur">
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          {canSave ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Info className="h-3.5 w-3.5" />
          )}
          {missingName && missingPrice
            ? "Falta el nombre y el precio"
            : missingName
              ? "Falta el nombre"
              : missingPrice
                ? "Falta el precio"
                : product
                  ? "Listo para guardar"
                  : "Listo para crear"}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-[#4338ca] hover:bg-slate-50"
          >
            Cancelar
          </button>
          <PosButton onClick={() => void save()} disabled={!canSave || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {product
              ? "Guardar cambios"
              : kind === "supply"
                ? "Crear insumo"
                : kind === "service"
                  ? "Crear servicio"
                  : "Crear producto"}
          </PosButton>
        </div>
      </div>

      {error ? (
        <p className="border-t border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Collapsible({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left"
      >
        <span>
          <span className="block text-sm font-bold text-slate-800">{title}</span>
          <span className="block text-xs text-slate-400">{subtitle}</span>
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

function CategoryList({
  categories,
  products,
  onNew,
  onEdit,
}: {
  categories: Category[];
  products: Product[];
  onNew: () => void;
  onEdit: (category: Category) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-base font-bold text-slate-900">Categorías</p>
          <p className="text-xs text-slate-500">
            Agrupa productos para encontrarlos más rápido.
          </p>
        </div>
        <PosButton onClick={onNew}>
          <Plus className="h-4 w-4" />
          Nueva categoría
        </PosButton>
      </div>

      {categories.length === 0 ? (
        <p className="px-6 py-16 text-center text-sm text-slate-500">
          Todavía no hay categorías.
        </p>
      ) : (
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => {
            const count = products.filter(
              (product) => product.category_id === category.id,
            ).length;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => onEdit(category)}
                className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left hover:bg-slate-50"
              >
                <span
                  className="h-8 w-8 shrink-0 rounded-lg"
                  style={{
                    backgroundColor: category.color ?? "#e2e8f0",
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">
                    {category.name}
                  </span>
                  <span className="block text-[11px] text-slate-400">
                    {count} {count === 1 ? "producto" : "productos"}
                    {category.active ? "" : " · Inactiva"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CategoryDialog({
  accountId,
  category,
  onClose,
  onSaved,
}: {
  accountId: string | null;
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? "");
  const [active, setActive] = useState(category?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!accountId) return;
    if (name.trim().length < 2) {
      setError("Escribe el nombre de la categoría.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      color: color || null,
      active,
    };

    const { error: dbError } = category
      ? await supabase.from("pos_categories").update(payload).eq("id", category.id)
      : await supabase
          .from("pos_categories")
          .insert({ account_id: accountId, ...payload });

    setSaving(false);
    if (dbError) {
      setError(
        dbError.code === "23505"
          ? "Ya existe una categoría con ese nombre."
          : dbError.message,
      );
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-black text-slate-900">
            {category ? "Editar categoría" : "Nueva categoría"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-slate-700">Nombre *</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </label>

          <div>
            <p className="text-xs font-bold text-slate-700">Color</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setColor("")}
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                  color === "" ? "border-slate-400" : "border-transparent"
                } bg-slate-100 text-slate-400`}
                title="Sin color"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              {CATEGORY_COLORS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setColor(value)}
                  className={`h-8 w-8 rounded-full border-2 ${
                    color === value ? "border-slate-700" : "border-transparent"
                  }`}
                  style={{ backgroundColor: value }}
                  title={value}
                />
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="h-4 w-4 accent-[#4338ca]"
            />
            Activa
          </label>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-[#4338ca] hover:bg-slate-50"
          >
            Cancelar
          </button>
          <PosButton onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {category ? "Guardar" : "Crear categoría"}
          </PosButton>
        </div>
      </div>
    </div>
  );
}

