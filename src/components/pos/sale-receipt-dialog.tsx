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

interface SaleDetail {
  id: string;
  number: number;
  status: string;
  subtotal_usd: number | string;
  discount_usd: number | string;
  discount_code: string | null;
  surcharge_usd: number | string;
  tax_iva_usd: number | string;
  tax_igtf_usd: number | string;
  total_usd: number | string;
  paid_usd: number | string;
  balance_usd: number | string;
  returned_usd?: number | string;
  change_usd?: number | string;
  change_bs?: number | string;
  exchange_rate_used: number | string;
  notes: string | null;
  created_at: string;
  shift_id: string | null;
  pos_customer_id: string | null;
  price_list_id: string | null;
  user_id: string | null;
  invoice_number?: number | string | null;
  control_number?: string | null;
  fiscal_serial?: string | null;
  fiscal_machine?: string | null;
  fiscal_issued_at?: string | null;
  fiscal_status?: "none" | "fiscal" | "void";
  customer_tax_id?: string | null;
  customer_legal_name?: string | null;
  customer_address?: string | null;
}

interface ItemRow {
  name: string;
  quantity: number | string;
  unit_price_usd: number | string;
  discount_usd: number | string;
  line_total_usd: number | string;
}

interface PaymentRow {
  method: string;
  currency: string;
  amount: number | string;
  amount_usd: number | string;
  igtf_usd: number | string;
}

interface SettingsRow {
  legal_name: string | null;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  receipt_title: string | null;
  receipt_footer: string | null;
  receipt_width: string | null;
  receipt_fields: Record<string, boolean> | null;
}

interface FiscalSettingsRow {
  legal_name: string | null;
  tax_id: string | null;
  fiscal_address: string | null;
  economic_activity: string | null;
  printer_serial: string | null;
  machine_number: string | null;
  invoice_series: string | null;
  legend: string | null;
}

const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((method) => [method.value, method.label]),
);

const DEFAULT_FIELDS: Record<string, boolean> = {
  legal_name: true,
  tax_id: true,
  address: true,
  phone: true,
  customer: true,
  sku: true,
  total_bs: true,
  rate: true,
  notes: true,
};

export function SaleReceiptDialog({
  saleId,
  open,
  onOpenChange,
}: {
  saleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { account, accountId } = useAuth();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [fiscal, setFiscal] = useState<FiscalSettingsRow | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [shiftNumber, setShiftNumber] = useState<number | null>(null);
  const [channelName, setChannelName] = useState("");
  const [cashier, setCashier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !saleId) return;

    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      const supabase = createClient();

      const [saleRes, itemsRes, paymentsRes, settingsRes, fiscalRes] =
        await Promise.all([
          supabase.from("pos_sales").select("*").eq("id", saleId).maybeSingle(),
          supabase
            .from("pos_sale_items")
            .select(
              "name, quantity, unit_price_usd, discount_usd, line_total_usd",
            )
            .eq("sale_id", saleId),
          supabase
            .from("pos_sale_payments")
            .select("method, currency, amount, amount_usd, igtf_usd")
            .eq("sale_id", saleId),
          supabase
            .from("pos_settings")
            .select(
              "legal_name, tax_id, address, phone, receipt_title, receipt_footer, receipt_width, receipt_fields",
            )
            .eq("account_id", accountId ?? "")
            .maybeSingle(),
          supabase
            .from("pos_fiscal_settings")
            .select(
              "legal_name, tax_id, fiscal_address, economic_activity, printer_serial, machine_number, invoice_series, legend",
            )
            .eq("account_id", accountId ?? "")
            .maybeSingle(),
        ]);

      if (!alive) return;

      if (saleRes.error || !saleRes.data) {
        setError(saleRes.error?.message ?? "No se encontró la venta.");
        setLoading(false);
        return;
      }

      const detail = saleRes.data as SaleDetail;
      setSale(detail);
      setItems((itemsRes.data ?? []) as ItemRow[]);
      setPayments((paymentsRes.data ?? []) as PaymentRow[]);
      setSettings((settingsRes.data as SettingsRow | null) ?? null);
      setFiscal((fiscalRes.data as FiscalSettingsRow | null) ?? null);

      if (detail.pos_customer_id) {
        const { data } = await supabase
          .from("pos_customers")
          .select("name")
          .eq("id", detail.pos_customer_id)
          .maybeSingle();
        if (alive) setCustomerName((data as { name: string } | null)?.name ?? "");
      } else if (alive) {
        setCustomerName("");
      }

      if (detail.shift_id) {
        const { data } = await supabase
          .from("pos_shifts")
          .select("number")
          .eq("id", detail.shift_id)
          .maybeSingle();
        if (alive) {
          setShiftNumber((data as { number: number } | null)?.number ?? null);
        }
      } else if (alive) {
        setShiftNumber(null);
      }

      if (detail.price_list_id) {
        const { data } = await supabase
          .from("pos_price_lists")
          .select("name")
          .eq("id", detail.price_list_id)
          .maybeSingle();
        if (alive) {
          setChannelName((data as { name: string } | null)?.name ?? "");
        }
      } else if (alive) {
        setChannelName("");
      }

      if (detail.user_id) {
        const { data } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", detail.user_id)
          .maybeSingle();
        if (alive) {
          setCashier(
            (data as { full_name: string | null } | null)?.full_name ?? "",
          );
        }
      } else if (alive) {
        setCashier("");
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [open, saleId]);

  if (!open) return null;

  const fields = {
    ...DEFAULT_FIELDS,
    ...(settings?.receipt_fields ?? {}),
  };
  const isFiscal = sale?.fiscal_status === "fiscal";
  const legalName = fiscal?.legal_name ?? settings?.legal_name;
  const taxId = fiscal?.tax_id ?? settings?.tax_id;
  const fiscalAddress = fiscal?.fiscal_address ?? settings?.address;
  const rate = toNumber(sale?.exchange_rate_used);
  const gross = toNumber(sale?.subtotal_usd) + toNumber(sale?.discount_usd);
  const width = settings?.receipt_width ?? "80";
  const widthClass =
    width === "58" ? "max-w-[210px]" : width === "letter" ? "max-w-[380px]" : "max-w-[290px]";
  const printWidth = width === "58" ? "58mm" : width === "letter" ? "180mm" : "80mm";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .pos-receipt-print, .pos-receipt-print * { visibility: visible !important; }
          .pos-receipt-print {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: ${printWidth} !important;
            max-width: none !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
          .pos-receipt-tools { display: none !important; }
          .pos-receipt-scroll {
            max-height: none !important;
            overflow: visible !important;
            padding: 0 !important;
            background: white !important;
          }
        }
      `}</style>

      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="pos-receipt-tools flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-sm font-bold text-slate-800">Recibo de venta</p>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pos-receipt-scroll max-h-[70vh] overflow-y-auto bg-slate-100 px-4 py-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
            </div>
          ) : error || !sale ? (
            <p className="rounded-xl bg-red-50 px-4 py-6 text-center text-sm text-red-700">
              {error ?? "No se pudo cargar la venta."}
            </p>
          ) : (
            <div
              className={`pos-receipt-print mx-auto ${widthClass} rounded-t-lg bg-white px-4 py-4 text-center shadow-sm`}
            >
              <p className="text-xs font-bold text-slate-800">
                {account?.name ?? "Mi negocio"}
              </p>
              {legalName ? (
                <p className="text-[10px] leading-snug text-slate-500">
                  {legalName}
                </p>
              ) : null}
              {taxId ? (
                <p className="text-[10px] text-slate-500">RIF: {taxId}</p>
              ) : null}
              {fields.phone && settings?.phone ? (
                <p className="text-[10px] text-slate-500">
                  Tel: {settings.phone}
                </p>
              ) : null}
              {fiscalAddress ? (
                <p className="text-[9px] leading-snug text-slate-400">
                  {fiscalAddress}
                </p>
              ) : null}
              {isFiscal && fiscal?.economic_activity ? (
                <p className="text-[9px] leading-snug text-slate-400">
                  {fiscal.economic_activity}
                </p>
              ) : null}

              <div className="my-2 border-t border-dashed border-slate-300" />

              <p className="text-[11px] font-bold text-slate-800">
                {isFiscal
                  ? "FACTURA"
                  : settings?.receipt_title || "Comprobante de venta"}
              </p>
              {isFiscal ? (
                <p className="text-[10px] font-semibold text-slate-600">
                  Factura N° {sale.invoice_number} · Control{" "}
                  {sale.control_number ?? "—"}
                </p>
              ) : (
                <p className="text-[9px] font-semibold text-slate-400">
                  Documento no fiscal
                </p>
              )}
              <div className="mt-1 text-left text-[9px] leading-snug text-slate-500">
                <p>Ticket #{sale.number}</p>
                <p>{formatDate(sale.created_at)}</p>
                {cashier ? <p>Cajero: {cashier}</p> : null}
                {shiftNumber ? <p>Turno: #{shiftNumber}</p> : null}
                {channelName ? <p>Canal: {channelName}</p> : null}
                {isFiscal ? (
                  <>
                    <p>
                      Cliente:{" "}
                      {sale.customer_legal_name || "Consumidor final"}
                    </p>
                    <p>RIF: {sale.customer_tax_id ?? "—"}</p>
                    {sale.customer_address ? (
                      <p>{sale.customer_address}</p>
                    ) : null}
                    <p>
                      Serie: {fiscal?.invoice_series ?? "—"} · Máquina:{" "}
                      {fiscal?.machine_number ?? "—"}
                    </p>
                    <p>Serial: {fiscal?.printer_serial ?? "—"}</p>
                  </>
                ) : fields.customer ? (
                  <p>Cliente: {customerName || "Consumidor final"}</p>
                ) : null}
              </div>

              <div className="my-2 border-t border-dashed border-slate-300" />

              <div className="space-y-1 text-left text-[10px]">
                {items.map((item, index) => (
                  <div key={index}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-700">
                          {toNumber(item.quantity)} × {item.name}
                        </p>
                        {toNumber(item.discount_usd) > 0 ? (
                          <p className="text-[9px] text-slate-400">
                            Descuento {formatUsd(toNumber(item.discount_usd))}
                          </p>
                        ) : null}
                      </div>
                      <p className="shrink-0 font-semibold text-slate-800">
                        {formatUsd(toNumber(item.line_total_usd))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="my-2 border-t border-dashed border-slate-300" />

              <div className="space-y-0.5 text-[10px]">
                <ReceiptRow label="Subtotal" value={formatUsd(gross)} />
                {toNumber(sale.discount_usd) > 0 ? (
                  <ReceiptRow
                    label={
                      sale.discount_code
                        ? `Descuento ${sale.discount_code}`
                        : "Descuento"
                    }
                    value={`− ${formatUsd(toNumber(sale.discount_usd))}`}
                  />
                ) : null}
                <ReceiptRow
                  label="IVA"
                  value={formatUsd(toNumber(sale.tax_iva_usd))}
                />
                {toNumber(sale.surcharge_usd) > 0 ? (
                  <ReceiptRow
                    label="Recargos"
                    value={formatUsd(toNumber(sale.surcharge_usd))}
                  />
                ) : null}
                <ReceiptRow
                  label="IGTF"
                  value={formatUsd(toNumber(sale.tax_igtf_usd))}
                />
                <div className="my-1 border-t border-slate-200" />
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-800">TOTAL</span>
                  <span className="font-bold text-slate-900">
                    {formatUsd(toNumber(sale.total_usd))}
                  </span>
                </div>
                {fields.total_bs ? (
                  <ReceiptRow
                    label="Total Bs"
                    value={formatBs(usdToBs(toNumber(sale.total_usd), rate))}
                  />
                ) : null}
                {fields.rate ? (
                  <ReceiptRow
                    label="Tasa"
                    value={rate > 0 ? formatBs(rate) : "—"}
                  />
                ) : null}
                {toNumber(sale.balance_usd) > 0.005 ? (
                  <ReceiptRow
                    label="Saldo pendiente"
                    value={formatUsd(toNumber(sale.balance_usd))}
                  />
                ) : null}
                {toNumber(sale.returned_usd) > 0.005 ? (
                  <ReceiptRow
                    label="Devuelto"
                    value={formatUsd(toNumber(sale.returned_usd))}
                  />
                ) : null}
                {toNumber(sale.change_usd) > 0.005 ||
                toNumber(sale.change_bs) > 0.005 ? (
                  <ReceiptRow
                    label="Vuelto"
                    value={[
                      toNumber(sale.change_usd) > 0.005
                        ? formatUsd(toNumber(sale.change_usd))
                        : null,
                      toNumber(sale.change_bs) > 0.005
                        ? formatBs(toNumber(sale.change_bs))
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                ) : null}
              </div>

              {payments.length > 0 ? (
                <>
                  <div className="my-2 border-t border-dashed border-slate-300" />
                  <div className="space-y-0.5 text-left text-[9px]">
                    <p className="font-semibold text-slate-600">Pagos</p>
                    {payments.map((payment, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between text-slate-500"
                      >
                        <span>
                          {METHOD_LABEL[payment.method] ?? payment.method}
                        </span>
                        <span>
                          {payment.currency === "VES"
                            ? formatBs(toNumber(payment.amount))
                            : formatUsd(toNumber(payment.amount))}
                          {toNumber(payment.igtf_usd) > 0
                            ? ` + IGTF ${formatUsd(toNumber(payment.igtf_usd))}`
                            : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {fields.notes && sale.notes ? (
                <p className="mt-2 text-left text-[9px] text-slate-400">
                  Nota: {sale.notes}
                </p>
              ) : null}

              {settings?.receipt_footer ? (
                <p className="mt-3 text-[9px] italic text-slate-500">
                  {settings.receipt_footer}
                </p>
              ) : null}
              {isFiscal && fiscal?.legend ? (
                <p className="mt-2 text-[8px] leading-snug text-slate-500">
                  {fiscal.legend}
                </p>
              ) : null}

              <div className="mt-3 h-2 w-full bg-[linear-gradient(-45deg,transparent_33.33%,#f1f5f9_33.33%,#f1f5f9_66.66%,transparent_66.66%)] bg-[length:8px_8px]" />
            </div>
          )}
        </div>

        <div className="pos-receipt-tools flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
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
            disabled={!sale}
            className="inline-flex items-center gap-2 rounded-xl bg-[#3f3fd8] px-4 py-2 text-sm font-bold text-white hover:bg-[#3535c4] disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
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
