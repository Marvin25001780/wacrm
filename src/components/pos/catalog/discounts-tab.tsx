"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Search, Tag, Trash2, X } from "lucide-react";

import { PosButton } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatUsd, round2, toNumber } from "@/lib/pos/money";
import type { Discount } from "./types";
import { inputClass } from "./types";

export function DiscountsTab({
  accountId,
  discounts,
  onChanged,
}: {
  accountId: string | null;
  discounts: Discount[];
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Discount | null>(null);
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return discounts;
    return discounts.filter(
      (discount) =>
        discount.name.toLowerCase().includes(term) ||
        discount.code.toLowerCase().includes(term),
    );
  }, [discounts, search]);

  async function toggleActive(discount: Discount) {
    const supabase = createClient();
    await supabase
      .from("pos_discounts")
      .update({ active: !discount.active })
      .eq("id", discount.id);
    onChanged();
  }

  async function remove(discount: Discount) {
    if (
      !window.confirm(
        `¿Eliminar el descuento ${discount.code}? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    const supabase = createClient();
    await supabase.from("pos_discounts").delete().eq("id", discount.id);
    onChanged();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-base font-bold text-slate-900">Descuentos</p>
          <p className="text-xs text-slate-500">
            Códigos que se aplican al cobrar.
          </p>
        </div>
        <PosButton
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Nuevo descuento
        </PosButton>
      </div>

      <div className="border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por código o nombre..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <Tag className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-bold text-slate-800">
            {discounts.length === 0
              ? "Todavía no hay descuentos"
              : "Sin resultados"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {discounts.length === 0
              ? "Crea un código y úsalo al cobrar en Vender."
              : "Prueba con otro código o nombre."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Nombre</th>
                <th className="px-4 py-2.5 font-semibold">Código</th>
                <th className="px-4 py-2.5 font-semibold">Tipo</th>
                <th className="px-4 py-2.5 text-right font-semibold">Valor</th>
                <th className="px-4 py-2.5 text-right font-semibold">Usos</th>
                <th className="px-4 py-2.5 font-semibold">Vigencia</th>
                <th className="px-4 py-2.5 text-right font-semibold">Activo</th>
                <th className="w-24 px-5 py-2.5 text-right font-semibold">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((discount) => (
                <tr key={discount.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-semibold text-slate-800">
                    {discount.name}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-bold text-[#4338ca]">
                      {discount.code}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {discount.kind === "percent" ? "Porcentaje" : "Monto fijo"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">
                    {discount.kind === "percent"
                      ? `${toNumber(discount.value)} %`
                      : formatUsd(toNumber(discount.value))}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    {discount.used_count}
                    {discount.max_uses ? ` / ${discount.max_uses}` : " / ∞"}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-500">
                    {validity(discount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={discount.active}
                      onClick={() => void toggleActive(discount)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${
                        discount.active ? "bg-[#4338ca]" : "bg-slate-200"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                          discount.active ? "left-[18px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(discount);
                          setOpen(true);
                        }}
                        title="Editar"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#4338ca]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(discount)}
                        title="Eliminar"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? (
        <DiscountDialog
          accountId={accountId}
          discount={editing}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function validity(discount: Discount): string {
  if (!discount.valid_from && !discount.valid_to) return "Siempre";
  const format = (value: string) =>
    new Intl.DateTimeFormat("es-VE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00`));
  if (discount.valid_from && discount.valid_to) {
    return `${format(discount.valid_from)} – ${format(discount.valid_to)}`;
  }
  if (discount.valid_from) return `Desde ${format(discount.valid_from)}`;
  return `Hasta ${format(discount.valid_to!)}`;
}

function DiscountDialog({
  accountId,
  discount,
  onClose,
  onSaved,
}: {
  accountId: string | null;
  discount: Discount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(discount?.name ?? "");
  const [code, setCode] = useState(discount?.code ?? "");
  const [kind, setKind] = useState<"percent" | "fixed">(
    discount?.kind ?? "percent",
  );
  const [value, setValue] = useState(
    discount ? String(toNumber(discount.value)) : "",
  );
  const [maxUses, setMaxUses] = useState(
    discount?.max_uses ? String(discount.max_uses) : "",
  );
  const [validFrom, setValidFrom] = useState(discount?.valid_from ?? "");
  const [validTo, setValidTo] = useState(discount?.valid_to ?? "");
  const [active, setActive] = useState(discount?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedCode = code.trim().toUpperCase();
  const amount = toNumber(value);
  const codeOk = /^[A-Z0-9_-]{3,24}$/.test(normalizedCode);
  const valueOk =
    kind === "percent" ? amount > 0 && amount <= 100 : amount > 0;
  const canSave =
    name.trim().length >= 2 && codeOk && valueOk && !saving;

  async function save() {
    if (!accountId || !canSave) return;
    if (validFrom && validTo && validTo < validFrom) {
      setError("La fecha final no puede ser anterior a la inicial.");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      code: normalizedCode,
      kind,
      value: round2(amount),
      max_uses: maxUses.trim() ? Math.max(1, Math.trunc(toNumber(maxUses))) : null,
      valid_from: validFrom || null,
      valid_to: validTo || null,
      active,
    };

    const { error: dbError } = discount
      ? await supabase
          .from("pos_discounts")
          .update(payload)
          .eq("id", discount.id)
      : await supabase
          .from("pos_discounts")
          .insert({ account_id: accountId, ...payload });

    setSaving(false);
    if (dbError) {
      setError(
        dbError.code === "23505"
          ? "Ya existe un descuento con ese código."
          : dbError.message,
      );
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-xl font-black text-slate-900">
            {discount ? "Editar descuento" : "Nuevo descuento"}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">Nombre *</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">Código *</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="VERANO10"
                className={`${inputClass} font-mono uppercase`}
              />
              <span
                className={`text-[10px] ${
                  code && !codeOk ? "text-red-600" : "text-slate-400"
                }`}
              >
                Se guarda en mayúsculas. De 3 a 24 letras, números, guion o
                guion bajo.
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">Tipo</span>
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as "percent" | "fixed")
                }
                className={inputClass}
              >
                <option value="percent">Porcentaje</option>
                <option value="fixed">Monto fijo</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">
                {kind === "percent" ? "Porcentaje" : "Monto"}
              </span>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                {kind === "fixed" ? (
                  <span className="text-sm text-slate-400">$</span>
                ) : null}
                <input
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full bg-transparent text-right text-sm outline-none"
                />
                {kind === "percent" ? (
                  <span className="text-sm text-slate-400">%</span>
                ) : null}
              </div>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">
                Usos máximos
              </span>
              <input
                value={maxUses}
                onChange={(event) => setMaxUses(event.target.value)}
                inputMode="numeric"
                placeholder="Ilimitado"
                className={inputClass}
              />
              <span className="text-[10px] text-slate-400">
                Vacío = ilimitado
              </span>
            </label>
            <div />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">
                Vigente desde
              </span>
              <input
                type="date"
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">
                Vigente hasta
              </span>
              <input
                type="date"
                value={validTo}
                onChange={(event) => setValidTo(event.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="h-4 w-4 accent-[#4338ca]"
            />
            Activo
          </label>

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
          <PosButton onClick={() => void save()} disabled={!canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {discount ? "Guardar" : "Crear descuento"}
          </PosButton>
        </div>
      </div>
    </div>
  );
}
