"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileCheck2,
  FileMinus2,
  Loader2,
  Save,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { PosButton, PosPageHeader } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { formatUsd, toNumber } from "@/lib/pos/money";

interface FiscalSettings {
  enabled: boolean;
  legal_name: string | null;
  tax_id: string | null;
  fiscal_address: string | null;
  economic_activity: string | null;
  printer_serial: string | null;
  machine_number: string | null;
  invoice_series: string | null;
  range_from: number | string | null;
  range_to: number | string | null;
  next_number: number | string | null;
  control_prefix: string | null;
  control_next: number | string | null;
  credit_series: string | null;
  credit_range_from: number | string | null;
  credit_range_to: number | string | null;
  credit_next_number: number | string | null;
  credit_control_prefix: string | null;
  credit_control_next: number | string | null;
  legend: string | null;
}

interface FiscalCreditNote {
  id: string;
  number: number | string;
  control_number: string | null;
  customer_legal_name: string | null;
  customer_tax_id: string | null;
  reason: string;
  subtotal_usd: number | string;
  tax_iva_usd: number | string;
  total_usd: number | string;
  issued_at: string;
  sale_id: string;
  sale: { number: number } | null;
}

interface FiscalInvoice {
  id: string;
  number: number;
  invoice_number: number | string;
  control_number: string | null;
  customer_legal_name: string | null;
  customer_tax_id: string | null;
  subtotal_usd: number | string;
  tax_iva_usd: number | string;
  total_usd: number | string;
  fiscal_issued_at: string | null;
  fiscal_serial: string | null;
  fiscal_machine: string | null;
}

interface FormState {
  enabled: boolean;
  legal_name: string;
  tax_id: string;
  fiscal_address: string;
  economic_activity: string;
  printer_serial: string;
  machine_number: string;
  invoice_series: string;
  range_from: string;
  range_to: string;
  next_number: string;
  control_prefix: string;
  control_next: string;
  credit_series: string;
  credit_range_from: string;
  credit_range_to: string;
  credit_next_number: string;
  credit_control_prefix: string;
  credit_control_next: string;
  legend: string;
}

const emptyForm: FormState = {
  enabled: false,
  legal_name: "",
  tax_id: "",
  fiscal_address: "",
  economic_activity: "",
  printer_serial: "",
  machine_number: "",
  invoice_series: "A",
  range_from: "",
  range_to: "",
  next_number: "",
  control_prefix: "",
  control_next: "1",
  credit_series: "NC",
  credit_range_from: "",
  credit_range_to: "",
  credit_next_number: "",
  credit_control_prefix: "",
  credit_control_next: "1",
  legend: "",
};

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]";

export default function FacturacionPage() {
  const { accountId } = useAuth();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [confirmed, setConfirmed] = useState(false);
  const [invoices, setInvoices] = useState<FiscalInvoice[]>([]);
  const [creditNotes, setCreditNotes] = useState<FiscalCreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [missing, setMissing] = useState(false);
  const [creditMissing, setCreditMissing] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [fiscalRes, settingsRes, invoicesRes, creditRes] = await Promise.all([
      supabase
        .from("pos_fiscal_settings")
        .select("*")
        .eq("account_id", accountId)
        .maybeSingle(),
      supabase
        .from("pos_settings")
        .select("legal_name, tax_id, address")
        .eq("account_id", accountId)
        .maybeSingle(),
      supabase
        .from("pos_sales")
        .select(
          "id, number, invoice_number, control_number, customer_legal_name, customer_tax_id, subtotal_usd, tax_iva_usd, total_usd, fiscal_issued_at, fiscal_serial, fiscal_machine",
        )
        .eq("account_id", accountId)
        .eq("fiscal_status", "fiscal")
        .order("fiscal_issued_at", { ascending: false })
        .limit(100),
      supabase
        .from("pos_fiscal_credit_notes")
        .select(
          "id, number, control_number, customer_legal_name, customer_tax_id, reason, subtotal_usd, tax_iva_usd, total_usd, issued_at, sale_id, sale:pos_sales(number)",
        )
        .eq("account_id", accountId)
        .order("issued_at", { ascending: false })
        .limit(100),
    ]);

    if (fiscalRes.error) {
      setMissing(true);
    } else {
      setMissing(false);
      const fiscal = fiscalRes.data as FiscalSettings | null;
      const base = settingsRes.data as {
        legal_name: string | null;
        tax_id: string | null;
        address: string | null;
      } | null;
      setForm(
        fiscal
          ? {
              enabled: fiscal.enabled,
              legal_name: fiscal.legal_name ?? "",
              tax_id: fiscal.tax_id ?? "",
              fiscal_address: fiscal.fiscal_address ?? "",
              economic_activity: fiscal.economic_activity ?? "",
              printer_serial: fiscal.printer_serial ?? "",
              machine_number: fiscal.machine_number ?? "",
              invoice_series: fiscal.invoice_series ?? "A",
              range_from: fiscal.range_from ? String(fiscal.range_from) : "",
              range_to: fiscal.range_to ? String(fiscal.range_to) : "",
              next_number: fiscal.next_number ? String(fiscal.next_number) : "",
              control_prefix: fiscal.control_prefix ?? "",
              control_next: fiscal.control_next ? String(fiscal.control_next) : "1",
              credit_series: fiscal.credit_series ?? "NC",
              credit_range_from: fiscal.credit_range_from
                ? String(fiscal.credit_range_from)
                : "",
              credit_range_to: fiscal.credit_range_to
                ? String(fiscal.credit_range_to)
                : "",
              credit_next_number: fiscal.credit_next_number
                ? String(fiscal.credit_next_number)
                : "",
              credit_control_prefix: fiscal.credit_control_prefix ?? "",
              credit_control_next: fiscal.credit_control_next
                ? String(fiscal.credit_control_next)
                : "1",
              legend: fiscal.legend ?? "",
            }
          : {
              ...emptyForm,
              legal_name: base?.legal_name ?? "",
              tax_id: base?.tax_id ?? "",
              fiscal_address: base?.address ?? "",
            },
      );
      setConfirmed(fiscal?.enabled ?? false);
    }

    setInvoices((invoicesRes.data ?? []) as unknown as FiscalInvoice[]);
    setCreditMissing(Boolean(creditRes.error));
    setCreditNotes((creditRes.data ?? []) as unknown as FiscalCreditNote[]);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rangeStatus = useMemo(() => {
    const from = toNumber(form.range_from);
    const to = toNumber(form.range_to);
    const next = toNumber(form.next_number);
    if (from <= 0 || to < from || next <= 0 || next > to) {
      return { valid: false, remaining: 0 };
    }
    return { valid: true, remaining: to - next + 1 };
  }, [form.range_from, form.range_to, form.next_number]);

  const creditRangeStatus = useMemo(() => {
    const from = toNumber(form.credit_range_from);
    const to = toNumber(form.credit_range_to);
    const next = toNumber(form.credit_next_number);
    if (from <= 0 || to < from || next <= 0 || next > to) {
      return { valid: false, remaining: 0 };
    }
    return { valid: true, remaining: to - next + 1 };
  }, [form.credit_range_from, form.credit_range_to, form.credit_next_number]);

  async function save() {
    if (!accountId) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    if (form.enabled) {
      if (!confirmed) {
        setError("Confirma que tienes autorización vigente del SENIAT.");
        setSaving(false);
        return;
      }
      if (
        !form.legal_name.trim() ||
        !form.tax_id.trim() ||
        !form.fiscal_address.trim() ||
        !form.range_from ||
        !form.range_to ||
        !form.next_number
      ) {
        setError(
          "Razón social, RIF, dirección fiscal, rango y siguiente número son obligatorios.",
        );
        setSaving(false);
        return;
      }
      if (!rangeStatus.valid) {
        setError(
          "Revisa el rango: el siguiente número debe estar entre el inicial y el final.",
        );
        setSaving(false);
        return;
      }
    }

    const creditTouched =
      form.credit_range_from.trim() !== "" ||
      form.credit_range_to.trim() !== "" ||
      form.credit_next_number.trim() !== "";
    if (creditTouched && !creditRangeStatus.valid) {
      setError(
        "Revisa el rango de notas de crédito: desde, hasta y siguiente deben ser coherentes.",
      );
      setSaving(false);
      return;
    }

    const supabase = createClient();
    const payload = {
      account_id: accountId,
      enabled: form.enabled,
      legal_name: form.legal_name.trim() || null,
      tax_id: form.tax_id.trim() || null,
      fiscal_address: form.fiscal_address.trim() || null,
      economic_activity: form.economic_activity.trim() || null,
      printer_serial: form.printer_serial.trim() || null,
      machine_number: form.machine_number.trim() || null,
      invoice_series: form.invoice_series.trim() || "A",
      range_from: toNumber(form.range_from) || null,
      range_to: toNumber(form.range_to) || null,
      next_number: toNumber(form.next_number) || null,
      control_prefix: form.control_prefix.trim() || null,
      control_next: toNumber(form.control_next) || 1,
      credit_series: form.credit_series.trim() || "NC",
      credit_range_from: toNumber(form.credit_range_from) || null,
      credit_range_to: toNumber(form.credit_range_to) || null,
      credit_next_number: toNumber(form.credit_next_number) || null,
      credit_control_prefix: form.credit_control_prefix.trim() || null,
      credit_control_next: toNumber(form.credit_control_next) || 1,
      legend: form.legend.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error: dbError } = await supabase
      .from("pos_fiscal_settings")
      .upsert(payload, { onConflict: "account_id" });

    setSaving(false);
    if (dbError) {
      setError(
        dbError.message.includes("credit_")
          ? "Falta aplicar la migración 101 (notas de crédito)."
          : dbError.message.includes("pos_fiscal_settings")
            ? "Falta aplicar la migración 100."
            : dbError.message,
      );
      return;
    }
    setSaved(true);
    void load();
  }

  function exportCsv() {
    const header = [
      "Factura",
      "Control",
      "Fecha",
      "RIF",
      "Cliente",
      "Base USD",
      "IVA USD",
      "Total USD",
      "Serie / Máquina",
    ];
    const lines = invoices.map((invoice) => [
      String(invoice.invoice_number),
      invoice.control_number ?? "",
      invoice.fiscal_issued_at
        ? new Intl.DateTimeFormat("es-VE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(invoice.fiscal_issued_at))
        : "",
      invoice.customer_tax_id ?? "",
      invoice.customer_legal_name ?? "",
      toNumber(invoice.subtotal_usd).toFixed(2),
      toNumber(invoice.tax_iva_usd).toFixed(2),
      toNumber(invoice.total_usd).toFixed(2),
      `${invoice.fiscal_serial ?? ""} / ${invoice.fiscal_machine ?? ""}`,
    ]);
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
    link.download = `libro-ventas-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportCreditCsv() {
    const header = [
      "Nota de crédito",
      "Control",
      "Fecha",
      "RIF",
      "Cliente",
      "Motivo",
      "Base USD",
      "IVA USD",
      "Total USD",
    ];
    const lines = creditNotes.map((note) => [
      String(note.number),
      note.control_number ?? "",
      new Intl.DateTimeFormat("es-VE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(note.issued_at)),
      note.customer_tax_id ?? "",
      note.customer_legal_name ?? "",
      note.reason,
      toNumber(note.subtotal_usd).toFixed(2),
      toNumber(note.tax_iva_usd).toFixed(2),
      toNumber(note.total_usd).toFixed(2),
    ]);
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
    link.download = `notas-credito-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <PosPageHeader
        title="Facturación"
        subtitle="Datos fiscales, rangos autorizados, facturas y notas de crédito."
        actions={
          <PosButton onClick={() => void save()} disabled={saving || missing}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Guardar configuración
          </PosButton>
        }
      />

      {missing ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <p className="font-bold">Falta aplicar la migración 100</p>
          <p className="mt-0.5">
            Ejecuta <code>supabase/migrations/100_pos_fiscal.sql</code> en
            Supabase para activar la facturación fiscal.
          </p>
        </div>
      ) : null}

      {!missing && creditMissing ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <p className="font-bold">Falta aplicar la migración 101</p>
          <p className="mt-0.5">
            Ejecuta{" "}
            <code>supabase/migrations/101_pos_fiscal_credit_notes.sql</code> en
            Supabase para activar las notas de crédito.
          </p>
        </div>
      ) : null}

      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Este módulo usa el rango y la máquina que tú configures. La validez
          fiscal depende de tu autorización vigente del SENIAT y de una
          impresora o proveedor de facturación certificado. Si no cuentas con
          eso, deja la facturación desactivada: el POS seguirá emitiendo
          comprobantes internos marcados como no fiscales.
        </p>
      </div>

      {saved ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">
          Configuración fiscal guardada.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center rounded-2xl border border-slate-200 bg-white py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  Datos del emisor
                </p>
                <p className="text-xs text-slate-500">
                  Aparecen en la factura y en el libro de ventas.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm({ ...form, enabled: event.target.checked })
                  }
                  className="h-4 w-4 accent-[#3f3fd8]"
                />
                Facturación fiscal activa
              </label>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Razón social *
                </span>
                <input
                  value={form.legal_name}
                  onChange={(event) =>
                    setForm({ ...form, legal_name: event.target.value })
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">RIF *</span>
                <input
                  value={form.tax_id}
                  onChange={(event) =>
                    setForm({ ...form, tax_id: event.target.value })
                  }
                  placeholder="J-12345678-9"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs font-bold text-slate-700">
                  Dirección fiscal *
                </span>
                <input
                  value={form.fiscal_address}
                  onChange={(event) =>
                    setForm({ ...form, fiscal_address: event.target.value })
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs font-bold text-slate-700">
                  Actividad económica
                </span>
                <input
                  value={form.economic_activity}
                  onChange={(event) =>
                    setForm({ ...form, economic_activity: event.target.value })
                  }
                  className={inputClass}
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  Máquina y rango autorizado
                </p>
                <p className="text-xs text-slate-500">
                  Debe coincidir con la autorización del SENIAT.
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-right">
                <p className="text-[10px] font-semibold uppercase text-slate-400">
                  Restantes
                </p>
                <p
                  className={`text-lg font-black ${
                    rangeStatus.valid ? "text-slate-800" : "text-red-600"
                  }`}
                >
                  {rangeStatus.valid ? rangeStatus.remaining : "—"}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Serie
                </span>
                <input
                  value={form.invoice_series}
                  onChange={(event) =>
                    setForm({ ...form, invoice_series: event.target.value })
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Serial de la máquina
                </span>
                <input
                  value={form.printer_serial}
                  onChange={(event) =>
                    setForm({ ...form, printer_serial: event.target.value })
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Número de máquina
                </span>
                <input
                  value={form.machine_number}
                  onChange={(event) =>
                    setForm({ ...form, machine_number: event.target.value })
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Desde *
                </span>
                <input
                  value={form.range_from}
                  onChange={(event) =>
                    setForm({ ...form, range_from: event.target.value })
                  }
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Hasta *
                </span>
                <input
                  value={form.range_to}
                  onChange={(event) =>
                    setForm({ ...form, range_to: event.target.value })
                  }
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Siguiente número *
                </span>
                <input
                  value={form.next_number}
                  onChange={(event) =>
                    setForm({ ...form, next_number: event.target.value })
                  }
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Prefijo de control
                </span>
                <input
                  value={form.control_prefix}
                  onChange={(event) =>
                    setForm({ ...form, control_prefix: event.target.value })
                  }
                  placeholder="Opcional"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Siguiente control
                </span>
                <input
                  value={form.control_next}
                  onChange={(event) =>
                    setForm({ ...form, control_next: event.target.value })
                  }
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
            </div>

            <label className="mt-3 flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-700">
                Leyenda de la factura
              </span>
              <textarea
                value={form.legend}
                onChange={(event) =>
                  setForm({ ...form, legend: event.target.value })
                }
                rows={2}
                placeholder="Texto legal que imprime tu proveedor fiscal."
                className={inputClass}
              />
            </label>

            <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#3f3fd8]"
              />
              Confirmo que tengo una autorización vigente del SENIAT y una
              impresora o proveedor de facturación certificado para este rango.
            </label>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  Notas de crédito
                </p>
                <p className="text-xs text-slate-500">
                  Rango autorizado para anular total o parcialmente una factura.
                  Si lo dejas vacío no podrás emitir notas de crédito.
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-right">
                <p className="text-[10px] font-semibold uppercase text-slate-400">
                  Restantes
                </p>
                <p
                  className={`text-lg font-black ${
                    creditRangeStatus.valid ? "text-slate-800" : "text-slate-300"
                  }`}
                >
                  {creditRangeStatus.valid ? creditRangeStatus.remaining : "—"}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">Serie</span>
                <input
                  value={form.credit_series}
                  onChange={(event) =>
                    setForm({ ...form, credit_series: event.target.value })
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">Desde</span>
                <input
                  value={form.credit_range_from}
                  onChange={(event) =>
                    setForm({ ...form, credit_range_from: event.target.value })
                  }
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">Hasta</span>
                <input
                  value={form.credit_range_to}
                  onChange={(event) =>
                    setForm({ ...form, credit_range_to: event.target.value })
                  }
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Siguiente número
                </span>
                <input
                  value={form.credit_next_number}
                  onChange={(event) =>
                    setForm({ ...form, credit_next_number: event.target.value })
                  }
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Prefijo de control
                </span>
                <input
                  value={form.credit_control_prefix}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      credit_control_prefix: event.target.value,
                    })
                  }
                  placeholder="Opcional"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-700">
                  Siguiente control
                </span>
                <input
                  value={form.credit_control_next}
                  onChange={(event) =>
                    setForm({ ...form, credit_control_next: event.target.value })
                  }
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  Facturas emitidas
                </p>
                <p className="text-[11px] text-slate-500">
                  Últimas 100 facturas fiscales.
                </p>
              </div>
              <button
                type="button"
                onClick={exportCsv}
                disabled={invoices.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Libro de ventas CSV
              </button>
            </div>

            {invoices.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <FileCheck2 className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm font-bold text-slate-700">
                  Todavía no hay facturas fiscales
                </p>
                <p className="text-xs text-slate-500">
                  Emite una desde el Historial de ventas.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Factura</th>
                      <th className="px-4 py-2.5">Control</th>
                      <th className="px-4 py-2.5">Cliente</th>
                      <th className="px-4 py-2.5">RIF</th>
                      <th className="px-4 py-2.5 text-right">IVA</th>
                      <th className="px-4 py-2.5 text-right">Total</th>
                      <th className="px-4 py-2.5">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="px-4 py-2.5 font-bold text-slate-800">
                          {invoice.invoice_number}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {invoice.control_number ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {invoice.customer_legal_name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {invoice.customer_tax_id ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-500">
                          {formatUsd(toNumber(invoice.tax_iva_usd))}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                          {formatUsd(toNumber(invoice.total_usd))}
                        </td>
                        <td className="px-4 py-2.5 text-[11px] text-slate-500">
                          {invoice.fiscal_issued_at
                            ? new Intl.DateTimeFormat("es-VE", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(invoice.fiscal_issued_at))
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  Notas de crédito emitidas
                </p>
                <p className="text-[11px] text-slate-500">
                  Últimas 100 notas. Cada devolución puede tener una sola.
                </p>
              </div>
              <button
                type="button"
                onClick={exportCreditCsv}
                disabled={creditNotes.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Notas de crédito CSV
              </button>
            </div>

            {creditNotes.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <FileMinus2 className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm font-bold text-slate-700">
                  Todavía no hay notas de crédito
                </p>
                <p className="text-xs text-slate-500">
                  Emítelas desde el Historial de ventas, en una venta facturada
                  con devoluciones.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Nota</th>
                      <th className="px-4 py-2.5">Control</th>
                      <th className="px-4 py-2.5">Venta</th>
                      <th className="px-4 py-2.5">Cliente</th>
                      <th className="px-4 py-2.5">RIF</th>
                      <th className="px-4 py-2.5 text-right">IVA</th>
                      <th className="px-4 py-2.5 text-right">Total</th>
                      <th className="px-4 py-2.5">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {creditNotes.map((note) => (
                      <tr key={note.id}>
                        <td className="px-4 py-2.5 font-bold text-slate-800">
                          {note.number}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {note.control_number ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          #{note.sale?.number ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {note.customer_legal_name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {note.customer_tax_id ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-500">
                          {formatUsd(toNumber(note.tax_iva_usd))}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                          {formatUsd(toNumber(note.total_usd))}
                        </td>
                        <td className="px-4 py-2.5 text-[11px] text-slate-500">
                          {new Intl.DateTimeFormat("es-VE", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(note.issued_at))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
