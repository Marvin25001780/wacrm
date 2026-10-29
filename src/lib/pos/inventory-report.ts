import { toNumber } from "@/lib/pos/money";

export interface InventoryProduct {
  id: string;
  name: string;
  sku: string | null;
  kind: string;
  stock: number | string;
  min_stock: number | string;
  cost_usd: number | string;
  price_usd: number | string;
}

export interface RotationRow {
  id: string;
  name: string;
  sold: number;
  stock: number;
  daysLeft: number | null;
  value: number;
}

export interface RestockRow {
  id: string;
  name: string;
  stock: number;
  min: number;
  missing: number;
}

export interface InventoryReport {
  costValue: number;
  saleValue: number;
  marginValue: number;
  productCount: number;
  lowStock: RestockRow[];
  rotation: RotationRow[];
}

/**
 * Rotación simple: unidades vendidas en el período contra el stock actual.
 * `days` es la longitud del período; con eso se estiman los días de stock.
 */
export function buildInventoryReport(
  products: InventoryProduct[],
  soldByProduct: Map<string, number>,
  days: number,
): InventoryReport {
  let costValue = 0;
  let saleValue = 0;
  const lowStock: RestockRow[] = [];
  const rotation: RotationRow[] = [];

  for (const product of products) {
    const isService = product.kind === "service";
    const stock = isService ? 0 : toNumber(product.stock);
    const min = toNumber(product.min_stock);
    const cost = toNumber(product.cost_usd);
    const price = toNumber(product.price_usd);

    if (!isService) {
      costValue += stock * cost;
      saleValue += stock * price;
    }

    if (!isService && stock <= min) {
      lowStock.push({
        id: product.id,
        name: product.name,
        stock,
        min,
        missing: Math.max(0, min - stock),
      });
    }

    const sold = soldByProduct.get(product.id) ?? 0;
    if (sold > 0) {
      const perDay = days > 0 ? sold / days : 0;
      rotation.push({
        id: product.id,
        name: product.name,
        sold,
        stock,
        daysLeft: perDay > 0 ? Math.round(stock / perDay) : null,
        value: stock * cost,
      });
    }
  }

  return {
    costValue,
    saleValue,
    marginValue: saleValue - costValue,
    productCount: products.filter((product) => product.kind !== "service").length,
    lowStock: lowStock.sort((a, b) => a.stock - b.stock),
    rotation: rotation.sort((a, b) => b.sold - a.sold),
  };
}

export interface AgingBucket {
  label: string;
  total: number;
  count: number;
}

const BUCKETS = ["Al día", "1-30 días", "31-60 días", "61-90 días", "Más de 90 días"];

/** Cubetas de antigüedad. `daysOverdue` negativo = todavía no vence. */
export function bucketAging(
  rows: { amount: number; daysOverdue: number | null }[],
): AgingBucket[] {
  const buckets: AgingBucket[] = BUCKETS.map((label) => ({
    label,
    total: 0,
    count: 0,
  }));

  for (const row of rows) {
    if (row.amount <= 0) continue;
    const days = row.daysOverdue;
    let index = 0;
    if (days == null) index = 0;
    else if (days <= 0) index = 0;
    else if (days <= 30) index = 1;
    else if (days <= 60) index = 2;
    else if (days <= 90) index = 3;
    else index = 4;
    buckets[index].total += row.amount;
    buckets[index].count += 1;
  }

  return buckets;
}
