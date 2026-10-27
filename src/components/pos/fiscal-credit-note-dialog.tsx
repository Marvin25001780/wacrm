"use client";

import { useCallback, useEffect, useState } from "react";
import { FileMinus2, Loader2, Printer, X } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { formatUsd, toNumber } from "@/lib/pos/money";
import { PosButton } from "@/components/pos/pos-shell";

interface SaleRow {
  id: string;
  number: number;
  total_usd: number | string;
  fiscal_status: "none" | "fiscal" | "void";
  invoice_number: number | string | null;
  customer_legal_name: string | null;
  customer_tax_id: string | null;
  customer_address: string | null;
}

interface ReturnRow {
  id: string;
  number: number;
  reason: string;
  subtotal_usd: number | string;
  tax_iva_usd: number | string;
  total_usd: number | string;
  created_at: string;
}

interface NoteRow {
  id: string;
  return_id: string;
  number: number | string;
  control_number: string | null;
  total_usd: number | string;
  issued_at: string;
}

interface IssuedNote {
  number: number | string;
  control_number: string | null;
  series: string | null;
  serial: string | null;
  machine: string | null;
  reason: string;
  subtotal_usd: number | string;
  tax_iva_usd: number | string;
  total_usd: number | string;
  customer_tax_id: string | null;
  customer_legal_name: string | null;
  customer_address: string | null;
  issued_at: string;
  return_number: number;
  sale_number: number;
  invoice_number: number | string | null;
}

interface FiscalRow {
  legal_name: string | null;
  tax_id: string | null;
  fiscal_address: string | null;
  legend: string | null;
}

export function FiscalCreditNoteDialog({
  saleId,
  open,
  onOpenChange,
  onIssued,
}: {
  saleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued?: () => void;
}) {
  const { accountId } = useAuth();
  const [sale, setSale] = useState<SaleRow | null>(null);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [fiscal, setFiscal] = useState<FiscalRow | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedNote | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!open || !saleId || !accountId) return;
    setLoading(true);
    setError(null);
    setIssued(null);
    const supabase = createClient();

    const [saleRes, returnsRes, notesRes, fiscalRes, settingsRes] =
      await Promise.all([
        supabase.from("pos_sales").select("*").eq("id", saleId).maybeSingle(),
        supabase
          .from("pos_sale_returns")
          .select("id, number, reason, subtotal_usd, tax_iva_usd, total_usd, created_at")
          .eq("sale_id", saleId)
          .order("created_at", { ascending: false }),
        supabase
          .from("pos_fiscal_credit_notes")
          .select("id, return_id, number, control_number, total_usd, issued_at")
          .eq("sale_id", saleId),
        supabase
          .from("pos_fiscal_settings")
          .select("legal_name, tax_id, fiscal_address, legend")
          .eq("account_id", accountId)
          .maybeSingle(),
        supabase
          .from("pos_settings")
          .select("phone")
          .eq("account_id", accountId)
          .maybeSingle(),
      ]);

    if (saleRes.error || !saleRes.data) {
      setError(saleRes.error?.message ?? "No se encontró la venta.");
      setLoading(false);
      return;
    }

    setSale(saleRes.data as SaleRow);
    setReturns((returnsRes.data ?? []) as ReturnRow[]);
    setNotes((notesRes.data ?? []) as NoteRow[]);
    setFiscal((fiscalRes.data as FiscalRow | null) ?? null);
    setPhone((settingsRes.data as { phone: string | null } | null)?.phone ?? null);
    setLoading(false);
  }, [accountId, open, saleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function issue(returnId: string) {
    setBusyId(returnId);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc(
      "pos_issue_fiscal_credit_note",
      { p_return_id: returnId },
    );
    setBusyId(null);

    if (rpcError) {
      setError(
        rpcError.message.includes("pos_fiscal_credit_notes") ||
          rpcError.message.includes("credit_range")
          ? "Falta aplicar la migración 101."
          : rpcError.message,
      );
      return;
    }

    setIssued(data as IssuedNote);
    await load();
    onIssued?.();
  }

  if (!open) return null;

  const noteFor = (returnId: string) =>
    notes.find((note) => note.return_id === returnId);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="my-6 w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
              <FileMinus2 className="h-4 w-4 text-[#3f3fd8]" />
              Notas de crédito
            </h2>
            <p className="text-xs text-slate-500">
              Venta #{sale?.number ?? "—"}
              {sale?.invoice_number ? ` · Factura N° ${sale.invoice_number}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
            </div>
          ) : returns.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
              Esta venta todavía no tiene devoluciones. Registra una devolución
              desde el Historial para poder emitir la nota de crédito.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {returns.map((row) => {
                const note = noteFor(row.id);
                return (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        Devolución #{row.number}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {new Intl.DateTimeFormat("es-VE", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        }).format(new Date(row.created_at))}{" "}
                        · {row.reason}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Base {formatUsd(toNumber(row.subtotal_usd))} · IVA{" "}
                        {formatUsd(toNumber(row.tax_iva_usd))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        {formatUsd(toNumber(row.total_usd))}
                      </span>
                      {note ? (
                        <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                          NC N° {note.number}
                        </span>
                      ) : (
                        <PosButton
                          onClick={() => void issue(row.id)}
                          disabled={busyId !== null}
                          className="!px-2.5 !py-1.5 !text-[11px]"
                        >
                          {busyId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FileMinus2 className="h-3.5 w-3.5" />
                          )}
                          Emitir nota
                        </PosButton>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {issued ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-[#3f3fd8]">
                  Nota de crédito N° {issued.number} · Control{" "}
                  {issued.control_number ?? "—"}
                </p>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#3f3fd8]"
                >
                  <Printer className="h-3 w-3" />
                  Imprimir
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-600">
                Total {formatUsd(toNumber(issued.total_usd))} · Venta #
                {issued.sale_number} · Factura N° {issued.invoice_number ?? "—"}
              </p>
            </div>
          ) : null}

          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            La nota de crédito usa su propio rango autorizado y anula
            fiscalmente lo devuelto. Si el rango no está configurado en
            Facturación, la emisión fallará.
          </p>
        </div>

        <div className="flex items-center justify-end border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-[#3f3fd8] hover:bg-slate-50"
          >
            Cerrar
          </button>
        </div>
      </div>

      {issued ? (
        <div className="pos-credit-note-print hidden">
          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              .pos-credit-note-print, .pos-credit-note-print * { visibility: visible !important; }
              .pos-credit-note-print {
                display: block !important;
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 80mm !important;
                padding: 6mm !important;
                background: white !important;
                color: #0f172a !important;
                font-family: ui-monospace, monospace !important;
                font-size: 10px !important;
              }
            }
          `}</style>
          <div className="text-center">
            <p className="text-xs font-bold">
              {fiscal?.legal_name ?? "Mi negocio"}
            </p>
            {fiscal?.tax_id ? <p>RIF: {fiscal.tax_id}</p> : null}
            {fiscal?.fiscal_address ? <p>{fiscal.fiscal_address}</p> : null}
            {phone ? <p>Tel: {phone}</p> : null}
            <p className="mt-2 font-bold">NOTA DE CRÉDITO</p>
            <p>
              N° {issued.number} · Control {issued.control_number ?? "—"}
            </p>
            <p>
              Serie {issued.series ?? "—"} · Máquina {issued.machine ?? "—"}
            </p>
            <p>Serial {issued.serial ?? "—"}</p>
          </div>
          <div className="mt-2 border-t border-dashed border-slate-400 pt-1 text-left">
            <p>
              Fecha:{" "}
              {new Intl.DateTimeFormat("es-VE", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(issued.issued_at))}
            </p>
            <p>Venta: #{issued.sale_number}</p>
            <p>Factura afectada: N° {issued.invoice_number ?? "—"}</p>
            <p>Devolución: #{issued.return_number}</p>
            <p>Cliente: {issued.customer_legal_name ?? "Consumidor final"}</p>
            <p>RIF: {issued.customer_tax_id ?? "—"}</p>
            {issued.customer_address ? <p>{issued.customer_address}</p> : null}
            <p>Motivo: {issued.reason}</p>
          </div>
          <div className="mt-2 border-t border-dashed border-slate-400 pt-1">
            <div className="flex justify-between">
              <span>Base imponible</span>
              <span>{formatUsd(toNumber(issued.subtotal_usd))}</span>
            </div>
            <div className="flex justify-between">
              <span>IVA</span>
              <span>{formatUsd(toNumber(issued.tax_iva_usd))}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>Total</span>
              <span>{formatUsd(toNumber(issued.total_usd))}</span>
            </div>
          </div>
          {fiscal?.legend ? (
            <p className="mt-2 text-center">{fiscal.legend}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
