// ============================================================
// Aritmética del POS.
//
// Regla: el cliente envía a la RPC el monto BASE de cada pago (sin
// IGTF). El servidor calcula el IVA por línea gravable y el IGTF
// solo sobre pagos en divisa. El total mostrado es base + IGTF.
// ============================================================

export const IVA_RATE = 16;
export const IGTF_RATE = 3;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    // Acepta "1.234,56" y "1234.56".
    const normalized = value.includes(",")
      ? value.replace(/\./g, "").replace(",", ".")
      : value;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** Convierte USD a bolívares con la tasa indicada. */
export function usdToBs(usd: number, rate: number): number {
  if (!rate || rate <= 0) return 0;
  return round2(usd * rate);
}

/** Convierte bolívares a USD con la tasa indicada. */
export function bsToUsd(bs: number, rate: number): number {
  if (!rate || rate <= 0) return 0;
  return round2(bs / rate);
}

export function ivaOf(base: number, rate = IVA_RATE): number {
  return round2(base * (rate / 100));
}

export function igtfOf(amountUsd: number, rate = IGTF_RATE): number {
  return round2(amountUsd * (rate / 100));
}

export interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxable: boolean;
  cost: number;
}

export interface Totals {
  subtotal: number;
  discount: number;
  iva: number;
  igtf: number;
  total: number;
  base: number;
  cost: number;
}

/**
 * Calcula los totales del carrito.
 * `usdPaidBase` es la suma de pagos en divisa (sin IGTF todavía).
 */
export function computeTotals(
  lines: CartLine[],
  options: { usdPaidBase?: number; ivaRate?: number; igtfRate?: number } = {},
): Totals {
  const ivaRate = options.ivaRate ?? IVA_RATE;
  const igtfRate = options.igtfRate ?? IGTF_RATE;

  let subtotal = 0;
  let discount = 0;
  let iva = 0;
  let cost = 0;

  for (const line of lines) {
    const gross = round2(line.quantity * line.unitPrice);
    const net = round2(gross - line.discount);
    subtotal = round2(subtotal + net);
    discount = round2(discount + line.discount);
    cost = round2(cost + line.quantity * line.cost);
    if (line.taxable) iva = round2(iva + ivaOf(net, ivaRate));
  }

  const base = round2(subtotal + iva);
  const usdPaidBase = options.usdPaidBase ?? base;
  const igtf = igtfOf(Math.min(usdPaidBase, base), igtfRate);

  return {
    subtotal,
    discount,
    iva,
    igtf,
    base,
    total: round2(base + igtf),
    cost,
  };
}

const usdFormatter = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const bsFormatter = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `$ 1.234,56` */
export function formatUsd(value: number): string {
  return `$ ${usdFormatter.format(Number(value) || 0)}`;
}

/** `Bs 1.234,56` */
export function formatBs(value: number): string {
  return `Bs ${bsFormatter.format(Number(value) || 0)}`;
}

/** `$ 1.234,56` + salto + `Bs 1.234,56` */
export function dual(valueUsd: number, rate: number): {
  usd: string;
  bs: string;
} {
  return { usd: formatUsd(valueUsd), bs: formatBs(usdToBs(valueUsd, rate)) };
}

export const PAYMENT_METHODS = [
  { value: "cash_usd", label: "Efectivo USD", currency: "USD" },
  { value: "zelle", label: "Zelle", currency: "USD" },
  { value: "cash_bs", label: "Efectivo Bs", currency: "VES" },
  { value: "pago_movil", label: "Pago Móvil", currency: "VES" },
  { value: "transfer_bs", label: "Transferencia Bs", currency: "VES" },
  { value: "card", label: "Punto de venta", currency: "VES" },
  { value: "other", label: "Otro", currency: "USD" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];
