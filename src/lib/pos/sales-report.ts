import { toNumber } from "@/lib/pos/money";

const TIMEZONE = "America/Caracas";

export const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const PAYMENT_LABEL: Record<string, string> = {
  cash_usd: "Efectivo USD",
  cash_bs: "Efectivo Bs",
  transfer_bs: "Transferencia Bs",
  pago_movil: "Pago móvil",
  zelle: "Zelle",
  card: "Tarjeta",
  other: "Otro",
};

const weekdayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  weekday: "short",
});
const hourFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

export interface SaleFact {
  id: string;
  price_list_id: string | null;
  pos_customer_id: string | null;
  user_id: string | null;
  subtotal_usd: number | string;
  total_usd: number | string;
  returned_usd: number | string;
  created_at: string;
}

export interface SaleItemFact {
  sale_id: string;
  product_id: string | null;
  name: string;
  quantity: number | string;
  unit_cost_usd: number | string;
  line_total_usd: number | string;
  sale: {
    total_usd: number | string;
    returned_usd: number | string;
  } | null;
  product: { category: { name: string } | null } | null;
}

export interface SalePaymentFact {
  method: string;
  amount_usd: number | string;
}

export interface ReportNames {
  priceLists: Map<string, string>;
  customers: Map<string, string>;
  users: Map<string, string>;
  /** Canal por defecto ("Tienda"). Null si la migración 102 no está aplicada. */
  defaultChannelName: string | null;
}

export interface BreakdownRow {
  label: string;
  count: number;
  total: number;
}

export interface ProductRow {
  label: string;
  quantity: number;
  total: number;
  margin: number;
}

export interface SalesReport {
  byChannel: BreakdownRow[];
  byPriceList: BreakdownRow[];
  byCustomer: BreakdownRow[];
  byUser: BreakdownRow[];
  byPayment: BreakdownRow[];
  byCategory: BreakdownRow[];
  topProducts: ProductRow[];
  lessProducts: ProductRow[];
  heat: number[][];
  heatMax: number;
}

/** Parte de la venta que sigue vigente después de devoluciones. */
export function keepRatio(total: number, returned: number): number {
  if (total <= 0) return 1;
  return Math.max(0, 1 - returned / total);
}

function addTo(
  map: Map<string, BreakdownRow>,
  label: string,
  total: number,
  count = 1,
) {
  const row = map.get(label) ?? { label, count: 0, total: 0 };
  row.count += count;
  row.total += total;
  map.set(label, row);
}

function sortRows(map: Map<string, BreakdownRow>): BreakdownRow[] {
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function buildSalesReport(
  sales: SaleFact[],
  items: SaleItemFact[],
  payments: SalePaymentFact[],
  names: ReportNames,
  channelBySale: Map<string, string> = new Map(),
): SalesReport {
  const channels = new Map<string, BreakdownRow>();
  const priceLists = new Map<string, BreakdownRow>();
  const customers = new Map<string, BreakdownRow>();
  const users = new Map<string, BreakdownRow>();
  const paymentRows = new Map<string, BreakdownRow>();
  const categories = new Map<string, BreakdownRow>();
  const productMap = new Map<string, ProductRow>();

  for (const sale of sales) {
    const net =
      toNumber(sale.subtotal_usd) *
      keepRatio(toNumber(sale.total_usd), toNumber(sale.returned_usd));

    addTo(
      channels,
      channelBySale.get(sale.id) ??
        names.defaultChannelName ??
        "Sin canal",
      net,
    );
    addTo(
      priceLists,
      sale.price_list_id
        ? (names.priceLists.get(sale.price_list_id) ?? "Lista sin nombre")
        : "Principal",
      net,
    );
    addTo(
      customers,
      sale.pos_customer_id
        ? (names.customers.get(sale.pos_customer_id) ?? "Cliente")
        : "Consumidor final",
      net,
    );
    addTo(
      users,
      sale.user_id ? (names.users.get(sale.user_id) ?? "Usuario") : "Sin usuario",
      net,
    );
  }

  for (const payment of payments) {
    addTo(
      paymentRows,
      PAYMENT_LABEL[payment.method] ?? payment.method,
      toNumber(payment.amount_usd),
    );
  }

  for (const item of items) {
    const ratio = item.sale
      ? keepRatio(toNumber(item.sale.total_usd), toNumber(item.sale.returned_usd))
      : 1;
    const quantity = toNumber(item.quantity) * ratio;
    const net = toNumber(item.line_total_usd) * ratio;
    const cost = toNumber(item.unit_cost_usd) * quantity;

    addTo(
      categories,
      item.product?.category?.name ?? "Sin categoría",
      net,
      quantity,
    );

    const key = item.product_id ?? `name:${item.name}`;
    const row = productMap.get(key) ?? {
      label: item.name,
      quantity: 0,
      total: 0,
      margin: 0,
    };
    row.quantity += quantity;
    row.total += net;
    row.margin += net - cost;
    productMap.set(key, row);
  }

  const products = [...productMap.values()]
    .filter((row) => row.quantity > 0)
    .sort((a, b) => b.total - a.total);

  // Con pocos productos, "más" y "menos" vendidos serían la misma lista.
  const lessProducts =
    products.length >= 6
      ? [...products]
          .sort((a, b) => a.quantity - b.quantity || a.total - b.total)
          .slice(0, 5)
      : [];

  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const sale of sales) {
    const date = new Date(sale.created_at);
    const day = WEEKDAY_INDEX[weekdayFormat.format(date)];
    const hour = Number(hourFormat.format(date));
    if (day == null || Number.isNaN(hour)) continue;
    heat[day][hour] += 1;
  }
  const heatMax = Math.max(1, ...heat.flat());

  return {
    byChannel: sortRows(channels),
    byPriceList: sortRows(priceLists),
    byCustomer: sortRows(customers),
    byUser: sortRows(users),
    byPayment: sortRows(paymentRows),
    byCategory: sortRows(categories),
    topProducts: products.slice(0, 5),
    lessProducts,
    heat,
    heatMax,
  };
}
