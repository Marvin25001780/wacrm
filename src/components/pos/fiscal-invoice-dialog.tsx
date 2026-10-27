"use client";

import { useState } from "react";
import { FileCheck2, Loader2, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { formatUsd, toNumber } from "@/lib/pos/money";
import { PosButton } from "@/components/pos/pos-shell";

export function FiscalInvoiceDialog({
  sale,
  onClose,
  onSaved,
}: {
  sale: { id: string; number: number; total_usd: number | string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [taxId, setTaxId] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    if (!taxId.trim() || !name.trim()) {
      setError("El RIF y el nombre o razón social son obligatorios.");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc(
      "pos_issue_fiscal_invoice",
      {
        p_sale_id: sale.id,
        p_customer_tax_id: taxId.trim(),
        p_customer_name: name.trim(),
        p_customer_address: address.trim() || null,
      },
    );
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
              <FileCheck2 className="h-4 w-4 text-[#3f3fd8]" />
              Emitir factura #{sale.number}
            </h2>
            <p className="text-xs text-slate-500">
              Total {formatUsd(toNumber(sale.total_usd))} · se usará el
              siguiente número del rango autorizado.
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
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-slate-700">RIF *</span>
            <input
              value={taxId}
              onChange={(event) => setTaxId(event.target.value)}
              placeholder="J-12345678-9"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-slate-700">
              Nombre o razón social *
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-slate-700">
              Dirección fiscal
            </span>
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
            />
          </label>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}

          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            La numeración se toma del rango configurado en Facturación. No se
            puede emitir dos veces la misma venta.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-[#3f3fd8] hover:bg-slate-50"
          >
            Cancelar
          </button>
          <PosButton onClick={() => void issue()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Emitir factura
          </PosButton>
        </div>
      </div>
    </div>
  );
}
