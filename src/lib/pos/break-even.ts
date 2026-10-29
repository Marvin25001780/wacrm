import { toNumber } from "@/lib/pos/money";

export interface FixedExpense {
  id: string;
  name: string;
  category: string;
  amount_usd: number | string;
  due_day: number | string;
  active: boolean;
}

export interface BreakEven {
  monthlyFixed: number;
  /** Margen bruto sobre ventas, de 0 a 1. */
  marginPct: number;
  /** Ventas necesarias al día para cubrir los fijos. Null si no hay margen. */
  dailyNeeded: number | null;
  monthlyNeeded: number | null;
  currentDaily: number;
  /** Ventas del período proyectadas a un mes. */
  projectedMonthly: number;
  /** Utilidad mensual estimada al ritmo actual. */
  projectedProfit: number;
  /** currentDaily / dailyNeeded. Null si no hay punto de equilibrio. */
  coveragePct: number | null;
  daysInMonth: number;
}

export function daysInMonth(reference = new Date()): number {
  return new Date(
    reference.getFullYear(),
    reference.getMonth() + 1,
    0,
  ).getDate();
}

export function fixedTotal(rows: FixedExpense[]): number {
  return rows
    .filter((row) => row.active)
    .reduce((sum, row) => sum + toNumber(row.amount_usd), 0);
}

export function fixedByCategory(
  rows: FixedExpense[],
): { label: string; total: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.active) continue;
    const label = row.category?.trim() || "general";
    map.set(label, (map.get(label) ?? 0) + toNumber(row.amount_usd));
  }
  return [...map.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Punto de equilibrio con los gastos fijos del mes.
 *
 * margen = (ventas netas - costo de lo vendido) / ventas netas
 * venta diaria necesaria = fijos del mes / (margen × días del mes)
 */
export function computeBreakEven(
  monthlyFixed: number,
  netSales: number,
  cogs: number,
  daysInPeriod: number,
  monthDays = daysInMonth(),
): BreakEven {
  const marginPct = netSales > 0 ? (netSales - cogs) / netSales : 0;
  const currentDaily = daysInPeriod > 0 ? netSales / daysInPeriod : 0;
  const projectedMonthly = currentDaily * monthDays;
  const monthlyNeeded =
    marginPct > 0 ? monthlyFixed / marginPct : null;
  const dailyNeeded =
    monthlyNeeded != null && monthDays > 0
      ? monthlyNeeded / monthDays
      : null;
  const projectedProfit = projectedMonthly * marginPct - monthlyFixed;

  return {
    monthlyFixed,
    marginPct,
    dailyNeeded,
    monthlyNeeded,
    currentDaily,
    projectedMonthly,
    projectedProfit,
    coveragePct:
      dailyNeeded != null && dailyNeeded > 0
        ? currentDaily / dailyNeeded
        : null,
    daysInMonth: monthDays,
  };
}
