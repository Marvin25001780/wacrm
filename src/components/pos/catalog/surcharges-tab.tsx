"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Receipt, Search, Trash2, X } from "lucide-react";

import { PosButton } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatUsd, round2, toNumber } from "@/lib/pos/money";
import type { Surcharge } from "./types";
import { inputClass } from "./types";

export function SurchargesTab({
  accountId,
  surcharges,
  onChanged,
}: {
  accountId: string | null;
  surcharges: Surcharge[];
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Surcharge | null>(null);
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return surcharges;
    return surcharges.filter((surcharge) =>
      surcharge.name.toLowerCase().includes(term),
    );
  }, [surcharges, search]);

  async function toggleActive(surcharge: Surcharge) {
    const supabase = createClient();
    await supabase
      .from("pos_surcharges")
      .update({ active: !surcharge.active })
      .eq("id", surcharge.id);
    onChanged();
  }

  async function remove(surcharge: Surcharge) {
    if (!window.confirm(`¿Eliminar el recargo "${surcharge.name}"?`)) return;
    const supabase = createClient();
    await supabase.from("pos_surcharges").delete().eq("id", surcharge.id);
    onChanged();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-base font-bold text-slate-900">Recargos</p>
          <p className="text-xs text-slate-500">
            Delivery, servicio de mesero y otros cargos que se suman al cobrar.
          </p>
        </div>
        <PosButton
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Nuevo recargo
        </PosButton>
      </div>

      <div className="border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <Receipt className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-bold text-slate-800">
            {surcharges.length === 0
              ? "Todavía no hay recargos"
              : "Sin resultados"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {surcharges.length === 0
              ? "Crea un cargo adicional y elige si lo paga el cliente."
              : "Prueba con otro nombre."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Nombre</th>
                <th className="px-4 py-2.5 font-semibold">Tipo</th>
                <th className="px-4 py-2.5 text-right font-semibold">Monto</th>
                <th className="px-4 py-2.5 font-semibold">Cobro</th>
                <th className="px-4 py-2.5 text-right font-semibold">Activo</th>
                <th className="w-24 px-5 py-2.5 text-right font-semibold">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((surcharge) => (
                <tr key={surcharge.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-semibold text-slate-800">
                    {surcharge.name}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {surcharge.kind === "percent" ? "Porcentaje" : "Monto fijo"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">
                    {surcharge.kind === "percent"
                      ? `${toNumber(surcharge.value)} %`
                      : formatUsd(toNumber(surcharge.value))}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        surcharge.charge_customer
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {surcharge.charge_customer
                        ? "Se cobra al cliente"
                        : "Costo interno"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={surcharge.active}
                      onClick={() => void toggleActive(surcharge)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${
                        surcharge.active ? "bg-[#4338ca]" : "bg-slate-200"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                          surcharge.active ? "left-[18px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(surcharge);
                          setOpen(true);
                        }}
                        title="Editar"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#4338ca]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(surcharge)}
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
        <SurchargeDialog
          accountId={accountId}
          surcharge={editing}
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

function SurchargeDialog({
  accountId,
  surcharge,
  onClose,
  onSaved,
}: {
  accountId: string | null;
  surcharge: Surcharge | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(surcharge?.name ?? "");
  const [kind, setKind] = useState<"percent" | "fixed">(
    surcharge?.kind ?? "fixed",
  );
  const [value, setValue] = useState(
    surcharge ? String(toNumber(surcharge.value)) : "",
  );
  const [chargeCustomer, setChargeCustomer] = useState(
    surcharge?.charge_customer ?? true,
  );
  const [active, setActive] = useState(surcharge?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = toNumber(value);
  const canSave = name.trim().length >= 2 && amount > 0 && !saving;

  async function save() {
    if (!accountId || !canSave) return;
    if (kind === "percent" && amount > 100) {
      setError("El porcentaje no puede pasar de 100.");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      kind,
      value: round2(amount),
      charge_customer: chargeCustomer,
      active,
    };

    const { error: dbError } = surcharge
      ? await supabase
          .from("pos_surcharges")
          .update(payload)
          .eq("id", surcharge.id)
      : await supabase
          .from("pos_surcharges")
          .insert({ account_id: accountId, ...payload });

    setSaving(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-xl font-black text-slate-900">
            {surcharge ? "Editar recargo" : "Nuevo recargo"}
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
              placeholder="Delivery, Servicio mesero..."
              className={inputClass}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">Tipo</span>
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as "percent" | "fixed")
                }
                className={inputClass}
              >
                <option value="fixed">Monto fijo</option>
                <option value="percent">Porcentaje</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">Monto</span>
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
          </div>

          <div className="rounded-xl border border-slate-200 px-3 py-3">
            <label className="flex items-start gap-2.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={chargeCustomer}
                onChange={(event) => setChargeCustomer(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#4338ca]"
              />
              <span>
                <span className="block font-semibold text-slate-800">
                  Se cobra al cliente
                </span>
                <span className="block text-[11px] text-slate-500">
                  Si está apagado, es un costo interno que no se suma al total
                  de la venta.
                </span>
              </span>
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
            {surcharge ? "Guardar" : "Crear recargo"}
          </PosButton>
        </div>
      </div>
    </div>
  );
}
