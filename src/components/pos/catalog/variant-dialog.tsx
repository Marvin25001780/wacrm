"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Tags, X } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { PosButton } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatUsd, toNumber } from "@/lib/pos/money";
import type { Product } from "./types";
import { inputClass } from "./types";

interface VariantForm {
  id: string | null;
  label: string;
  sku: string;
  barcode: string;
  price: string;
  stock: string;
  active: boolean;
}

const emptyForm: VariantForm = {
  id: null,
  label: "",
  sku: "",
  barcode: "",
  price: "",
  stock: "0",
  active: true,
};

export function VariantDialog({
  product,
  onClose,
  onChanged,
}: {
  product: Product | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { accountId } = useAuth();
  const [variants, setVariants] = useState<Product[]>([]);
  const [parentIsParent, setParentIsParent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<VariantForm | null>(null);

  const load = useCallback(async () => {
    if (!product || !accountId) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: dbError } = await supabase
      .from("pos_products")
      .select(
        "id, name, sku, barcode, description, kind, unit, cost_usd, price_usd, stock, min_stock, taxable, track_inventory, active, category_id, parent_product_id, is_parent, variant_label",
      )
      .eq("account_id", accountId)
      .eq("parent_product_id", product.id)
      .order("name");

    if (dbError) {
      setError(
        dbError.message.includes("parent_product_id")
          ? "Falta aplicar la migración 097."
          : dbError.message,
      );
      setLoading(false);
      return;
    }

    setVariants((data ?? []) as Product[]);
    setParentIsParent(product.is_parent || (data ?? []).length > 0);
    setLoading(false);
  }, [product, accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!product) return null;

  async function convertParent() {
    if (!accountId || parentIsParent) return true;
    const supabase = createClient();
    const parentSku = product!.sku;
    const parentBarcode = product!.barcode;
    const parentStock = toNumber(product!.stock);
    const parentTrack = product!.track_inventory;

    const { error: parentError } = await supabase
      .from("pos_products")
      .update({
        is_parent: true,
        stock: 0,
        sku: null,
        barcode: null,
        track_inventory: false,
      })
      .eq("id", product!.id);

    if (parentError) {
      setError(parentError.message);
      return false;
    }

    const { data: standard, error: standardError } = await supabase
      .from("pos_products")
      .insert({
        account_id: accountId,
        parent_product_id: product!.id,
        is_parent: false,
        variant_label: "Estándar",
        name: `${product!.name} · Estándar`,
        sku: parentSku,
        barcode: parentBarcode,
        description: product!.description,
        kind: product!.kind,
        unit: product!.unit,
        category_id: product!.category_id,
        cost_usd: toNumber(product!.cost_usd),
        price_usd: toNumber(product!.price_usd),
        stock: 0,
        min_stock: toNumber(product!.min_stock),
        taxable: product!.taxable,
        track_inventory: parentTrack,
        active: true,
      })
      .select("id")
      .single();

    if (standardError || !standard) {
      await supabase
        .from("pos_products")
        .update({
          is_parent: false,
          stock: parentStock,
          sku: parentSku,
          barcode: parentBarcode,
          track_inventory: parentTrack,
        })
        .eq("id", product!.id);
      setError(
        standardError?.message ?? "No se pudo crear la variante base.",
      );
      return false;
    }

    if (parentStock > 0 && product!.kind !== "service") {
      const { error: stockError } = await supabase.rpc(
        "pos_create_adjustment",
        {
          p_payload: {
            type: "count",
            note: "Stock inicial de variante Estándar",
            items: [
              {
                product_id: (standard as { id: string }).id,
                value: parentStock,
              },
            ],
          },
        },
      );
      if (stockError) {
        setError(`Variante creada, pero no el stock: ${stockError.message}`);
      }
    }

    setParentIsParent(true);
    return true;
  }

  async function save() {
    if (!accountId || !form) return;
    if (form.label.trim().length < 1) {
      setError("Escribe la etiqueta de la variante (Talla M, Rojo...).");
      return;
    }
    if (toNumber(form.price) <= 0) {
      setError("La variante necesita un precio.");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const label = form.label.trim();
    const payload = {
      variant_label: label,
      name: `${product!.name} · ${label}`,
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      price_usd: toNumber(form.price),
      active: form.active,
    };

    if (form.id) {
      const { error: updateError } = await supabase
        .from("pos_products")
        .update(payload)
        .eq("id", form.id);
      setSaving(false);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setForm(null);
      await load();
      onChanged();
      return;
    }

    if (!parentIsParent) {
      const converted = await convertParent();
      if (!converted) {
        setSaving(false);
        return;
      }
    }

    const { data: created, error: insertError } = await supabase
      .from("pos_products")
      .insert({
        account_id: accountId,
        parent_product_id: product!.id,
        is_parent: false,
        ...payload,
        kind: product!.kind,
        unit: product!.unit,
        category_id: product!.category_id,
        cost_usd: toNumber(product!.cost_usd),
        stock: 0,
        min_stock: toNumber(product!.min_stock),
        taxable: product!.taxable,
        track_inventory: product!.track_inventory,
      })
      .select("id")
      .single();

    if (insertError || !created) {
      setSaving(false);
      setError(insertError?.message ?? "No se pudo crear la variante.");
      return;
    }

    if (toNumber(form.stock) > 0 && product!.kind !== "service") {
      const { error: stockError } = await supabase.rpc(
        "pos_create_adjustment",
        {
          p_payload: {
            type: "count",
            note: `Stock inicial variante ${label}`,
            items: [
              {
                product_id: (created as { id: string }).id,
                value: toNumber(form.stock),
              },
            ],
          },
        },
      );
      if (stockError) {
        setSaving(false);
        setError(
          `Variante creada, pero no el stock: ${stockError.message}`,
        );
        await load();
        onChanged();
        return;
      }
    }

    setSaving(false);
    setForm(null);
    await load();
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black text-slate-900">
              <Tags className="h-5 w-5 text-[#4338ca]" />
              Variantes
            </h2>
            <p className="text-xs text-slate-500">
              {product.name} · cada variante tiene su stock, SKU y precio.
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

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {!parentIsParent && !form ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Al crear la primera variante, el producto base deja de venderse.
              Su stock actual pasa a una variante <strong>Estándar</strong>.
            </div>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-[#4338ca]" />
            </div>
          ) : variants.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              Todavía no hay variantes.
            </p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Variante</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2 text-right">Precio</th>
                    <th className="px-3 py-2 text-right">Stock</th>
                    <th className="px-3 py-2 text-right">Activa</th>
                    <th className="w-12 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {variants.map((variant) => (
                    <tr key={variant.id}>
                      <td className="px-3 py-2 font-semibold text-slate-700">
                        {variant.variant_label || variant.name}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {variant.sku ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {formatUsd(toNumber(variant.price_usd))}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {product.kind === "service" || !variant.track_inventory
                          ? "—"
                          : `${toNumber(variant.stock)} ${variant.unit}`}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            variant.active
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {variant.active ? "Sí" : "No"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setForm({
                              id: variant.id,
                              label: variant.variant_label ?? "",
                              sku: variant.sku ?? "",
                              barcode: variant.barcode ?? "",
                              price: String(toNumber(variant.price_usd)),
                              stock: String(toNumber(variant.stock)),
                              active: variant.active,
                            });
                            setError(null);
                          }}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#4338ca]"
                          title="Editar variante"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {form ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="text-sm font-bold text-slate-800">
                {form.id ? "Editar variante" : "Nueva variante"}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-700">
                    Etiqueta *
                  </span>
                  <input
                    value={form.label}
                    onChange={(event) =>
                      setForm({ ...form, label: event.target.value })
                    }
                    placeholder="Talla M, Rojo, 500 ml..."
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-700">
                    Precio *
                  </span>
                  <input
                    value={form.price}
                    onChange={(event) =>
                      setForm({ ...form, price: event.target.value })
                    }
                    inputMode="decimal"
                    placeholder="0,00"
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-700">SKU</span>
                  <input
                    value={form.sku}
                    onChange={(event) =>
                      setForm({ ...form, sku: event.target.value })
                    }
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-700">
                    Código de barras
                  </span>
                  <input
                    value={form.barcode}
                    onChange={(event) =>
                      setForm({ ...form, barcode: event.target.value })
                    }
                    className={inputClass}
                  />
                </label>
                {!form.id && product.kind !== "service" ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-slate-700">
                      Stock inicial
                    </span>
                    <input
                      value={form.stock}
                      onChange={(event) =>
                        setForm({ ...form, stock: event.target.value })
                      }
                      inputMode="decimal"
                      className={inputClass}
                    />
                  </label>
                ) : null}
                <label className="flex items-center gap-2 pt-5 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) =>
                      setForm({ ...form, active: event.target.checked })
                    }
                    className="h-4 w-4 accent-[#4338ca]"
                  />
                  Activa en el POS
                </label>
              </div>

              {error ? (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              ) : null}

              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setForm(null);
                    setError(null);
                  }}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-[#4338ca] hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <PosButton
                  onClick={() => void save()}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {form.id ? "Guardar variante" : "Crear variante"}
                </PosButton>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex justify-end">
              <PosButton
                onClick={() => {
                  setForm({
                    ...emptyForm,
                    price: String(toNumber(product.price_usd)),
                  });
                  setError(null);
                }}
              >
                <Plus className="h-4 w-4" />
                Agregar variante
              </PosButton>
            </div>
          )}

          {error && !form ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <PosButton variant="outline" onClick={onClose}>
            Cerrar
          </PosButton>
        </div>
      </div>
    </div>
  );
}
