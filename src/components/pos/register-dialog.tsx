"use client";

import { useState } from "react";
import { Loader2, Plus, Store, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { PosButton } from "@/components/pos/pos-shell";

interface RegisterRow {
  id: string;
  name: string;
  active: boolean;
}

export function RegisterDialog({
  accountId,
  registers,
  onClose,
  onChanged,
}: {
  accountId: string | null;
  registers: RegisterRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!accountId || name.trim().length < 2) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: dbError } = await supabase.from("pos_registers").insert({
      account_id: accountId,
      name: name.trim(),
      active: true,
    });
    setSaving(false);
    if (dbError) {
      setError(
        dbError.code === "23505"
          ? "Ya existe una caja con ese nombre."
          : dbError.message,
      );
      return;
    }
    setName("");
    onChanged();
  }

  async function rename(register: RegisterRow, next: string) {
    const value = next.trim();
    if (!value || value === register.name) return;
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("pos_registers")
      .update({ name: value })
      .eq("id", register.id);
    if (dbError) {
      setError(
        dbError.code === "23505"
          ? "Ya existe una caja con ese nombre."
          : dbError.message,
      );
      return;
    }
    onChanged();
  }

  async function toggle(register: RegisterRow) {
    const supabase = createClient();
    await supabase
      .from("pos_registers")
      .update({ active: !register.active })
      .eq("id", register.id);
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
              <Store className="h-4 w-4 text-[#3f3fd8]" />
              Cajas
            </h2>
            <p className="text-xs text-slate-500">
              Cada caja tiene su propio turno y arqueo.
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

        <div className="px-5 py-4">
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void add();
              }}
              placeholder="Nueva caja (Caja 02, Delivery...)"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
            />
            <PosButton
              onClick={() => void add()}
              disabled={saving || name.trim().length < 2}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Agregar
            </PosButton>
          </div>

          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {registers.map((register) => (
              <div
                key={register.id}
                className="flex items-center gap-2 px-3 py-2.5"
              >
                <input
                  key={`${register.id}-${register.name}`}
                  defaultValue={register.name}
                  onBlur={(event) => void rename(register, event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 text-sm font-semibold text-slate-800 outline-none hover:border-slate-200 focus:border-[#3f3fd8]"
                />
                <button
                  type="button"
                  role="switch"
                  aria-checked={register.active}
                  onClick={() => void toggle(register)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    register.active ? "bg-[#3f3fd8]" : "bg-slate-200"
                  }`}
                  title={register.active ? "Activa" : "Inactiva"}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      register.active ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>

          {error ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
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
