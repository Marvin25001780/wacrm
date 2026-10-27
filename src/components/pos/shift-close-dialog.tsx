"use client";

import { useEffect, useState } from "react";
import { Loader2, Printer, X } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import {
  PAYMENT_METHODS,
  formatBs,
  formatUsd,
  toNumber,
  usdToBs,
} from "@/lib/pos/money";

export interface ShiftPrintMethod {
  method: string;
  amount: number | string;
  amount_usd: number | string;
}

export interface ShiftPrintData {
  number: number;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  opening_usd: number | string;
  opening_bs: number | string;
  rate_open: number | string;
  sales_usd: number | string;
  sales_count: number;
  expected_usd: number | string;
  expected_bs: number | string;
  counted_usd?: number | string | null;
  counted_bs?: number | string | null;
  difference_usd?: number | string;
  difference_bs?: number | string;
  by_method: ShiftPrintMethod[];
  usd_breakdown?: Record<string, number>;
  bs_breakdown?: Record<string, number>;
  notes?: string | null;
}

interface SettingsRow {
  legal_name: string | null;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  receipt_footer: string | null;
}

const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((method) => [method.value, method.label]),
);

const METHOD_CURRENCY: Record<string, "USD" | "VES"> = Object.fromEntries(
  PAYMENT_METHODS.map((method) => [method.value, method.currency]),
);

export function ShiftCloseDialog({
  data,
  open,
  onOpenChange,
}: {
  data: ShiftPrintData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { account, accountId } = useAuth();
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !accountId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data: row } = await supabase
        .from("pos_settings")
        .select("legal_name, tax_id, address, phone, receipt_footer")
        .eq("account_id", accountId)
        .maybeSingle();
      if (alive) {
        setSettings((row as SettingsRow | null) ?? null);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, accountId]);

  if (!open || !data) return null;

  const rate = toNumber(data.rate_open);
  const isClosed = data.status === "closed";
  const differenceUsd = toNumber(data.difference_usd);
  const differenceBs = toNumber(data.difference_bs);
  const usdEntries = Object.entries(data.usd_breakdown ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[0]) - Number(a[0]));
  const bsEntries = Object.entries(data.bs_breakdown ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[0]) - Number(a[0]));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .pos-shift-print, .pos-shift-print * { visibility: visible !important; }
          .pos-shift-print {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 80mm !important;
            max-width: none !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
          .pos-shift-tools { display: none !important; }
          .pos-shift-scroll {
            max-height: none !important;
            overflow: visible !important;
            padding: 0 !important;
            background: white !important;
          }
        }
      `}</style>

      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="pos-shift-tools flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-sm font-bold text-slate-800">
            {isClosed ? "Cierre de turno" : "Corte de turno"}
          </p>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pos-shift-scroll max-h-[70vh] overflow-y-auto bg-slate-100 px-4 py-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
            </div>
          ) : (
            <div className="pos-shift-print mx-auto max-w-[290px] rounded-t-lg bg-white px-4 py-4 text-center shadow-sm">
              <p className="text-xs font-bold text-slate-800">
                {account?.name ?? "Mi negocio"}
              </p>
              {settings?.legal_name ? (
                <p className="text-[10px] leading-snug text-slate-500">
                  {settings.legal_name}
                </p>
              ) : null}
              {settings?.tax_id ? (
                <p className="text-[10px] text-slate-500">
                  RIF: {settings.tax_id}
                </p>
              ) : null}
              {settings?.phone ? (
                <p className="text-[10px] text-slate-500">
                  Tel: {settings.phone}
                </p>
              ) : null}
              {settings?.address ? (
                <p className="text-[9px] leading-snug text-slate-400">
                  {settings.address}
                </p>
              ) : null}

              <div className="my-2 border-t border-dashed border-slate-300" />

              <p className="text-[11px] font-semibold text-slate-700">
                {isClosed ? "Cierre de turno" : "Corte de turno (parcial)"}
              </p>
              <p className="text-[10px] text-slate-500">
                Turno #{data.number}
              </p>

              <div className="mt-1 text-left text-[9px] leading-snug text-slate-500">
                <p>Apertura: {formatDate(data.opened_at)}</p>
                {data.closed_at ? (
                  <p>Cierre: {formatDate(data.closed_at)}</p>
                ) : (
                  <p>Generado: {formatDate(new Date().toISOString())}</p>
                )}
                <p>
                  Tasa: {rate > 0 ? formatBs(rate) : "sin tasa"}
                </p>
              </div>

              <div className="my-2 border-t border-dashed border-slate-300" />

              <div className="space-y-0.5 text-[10px]">
                <Row
                  label="Ventas del turno"
                  value={formatUsd(toNumber(data.sales_usd))}
                />
                <Row
                  label="Tickets"
                  value={String(data.sales_count)}
                />
                <Row
                  label="Fondo inicial USD"
                  value={formatUsd(toNumber(data.opening_usd))}
                />
                <Row
                  label="Fondo inicial Bs"
                  value={formatBs(toNumber(data.opening_bs))}
                />
              </div>

              <div className="my-2 border-t border-dashed border-slate-300" />

              <p className="text-left text-[10px] font-semibold text-slate-600">
                Cobros por método
              </p>
              <div className="mt-1 space-y-0.5 text-left text-[9px]">
                {data.by_method.length === 0 ? (
                  <p className="text-slate-400">Sin cobros registrados.</p>
                ) : (
                  data.by_method.map((row) => {
                    const currency = METHOD_CURRENCY[row.method] ?? "USD";
                    return (
                      <div
                        key={row.method}
                        className="flex items-center justify-between text-slate-500"
                      >
                        <span>{METHOD_LABEL[row.method] ?? row.method}</span>
                        <span className="text-right">
                          {currency === "VES"
                            ? formatBs(toNumber(row.amount))
                            : formatUsd(toNumber(row.amount_usd))}
                          <span className="block text-[8px] text-slate-400">
                            {formatUsd(toNumber(row.amount_usd))}
                          </span>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="my-2 border-t border-dashed border-slate-300" />

              <div className="space-y-0.5 text-[10px]">
                <Row
                  label="Efectivo esperado USD"
                  value={formatUsd(toNumber(data.expected_usd))}
                />
                <Row
                  label="Efectivo esperado Bs"
                  value={formatBs(toNumber(data.expected_bs))}
                />
                {isClosed ? (
                  <>
                    <Row
                      label="Contado USD"
                      value={formatUsd(toNumber(data.counted_usd))}
                    />
                    <Row
                      label="Contado Bs"
                      value={formatBs(toNumber(data.counted_bs))}
                    />
                    <div className="my-1 border-t border-slate-200" />
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-800">
                        Diferencia
                      </span>
                      <span
                        className={`font-bold ${
                          Math.abs(differenceUsd) < 0.005
                            ? "text-emerald-700"
                            : "text-red-700"
                        }`}
                      >
                        {formatUsd(differenceUsd)}
                      </span>
                    </div>
                    <Row
                      label="Diferencia en Bs"
                      value={formatBs(differenceBs)}
                    />
                  </>
                ) : (
                  <p className="mt-1 text-left text-[9px] text-slate-400">
                    Este corte es informativo. El arqueo definitivo se guarda
                    al cerrar el turno.
                  </p>
                )}
              </div>

              {isClosed && (usdEntries.length > 0 || bsEntries.length > 0) ? (
                <>
                  <div className="my-2 border-t border-dashed border-slate-300" />
                  <p className="text-left text-[10px] font-semibold text-slate-600">
                    Desglose contado
                  </p>
                  <div className="mt-1 space-y-0.5 text-[9px]">
                    {usdEntries.map(([denom, count]) => (
                      <Row
                        key={`u-${denom}`}
                        label={`${formatUsd(Number(denom))} × ${count}`}
                        value={formatUsd(
                          Number(denom) * Number(count),
                        )}
                      />
                    ))}
                    {bsEntries.map(([denom, count]) => (
                      <Row
                        key={`b-${denom}`}
                        label={`${formatBs(Number(denom))} × ${count}`}
                        value={formatBs(
                          Number(denom) * Number(count),
                        )}
                      />
                    ))}
                  </div>
                </>
              ) : null}

              {data.notes ? (
                <>
                  <div className="my-2 border-t border-dashed border-slate-300" />
                  <p className="text-left text-[9px] text-slate-500">
                    Nota: {data.notes}
                  </p>
                </>
              ) : null}

              {settings?.receipt_footer ? (
                <p className="mt-3 text-[9px] italic text-slate-500">
                  {settings.receipt_footer}
                </p>
              ) : null}

              <div className="mt-3 h-2 w-full bg-[linear-gradient(-45deg,transparent_33.33%,#f1f5f9_33.33%,#f1f5f9_66.66%,transparent_66.66%)] bg-[length:8px_8px]" />
            </div>
          )}
        </div>

        <div className="pos-shift-tools flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-[#3f3fd8] hover:bg-slate-50"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#3f3fd8] px-4 py-2 text-sm font-bold text-white hover:bg-[#3535c4]"
          >
            <Printer className="h-4 w-4" />
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Caracas",
  }).format(new Date(value));
}
