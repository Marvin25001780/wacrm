// ============================================================
// Reportes de cartera — módulo 2.5
//
// Analítica DERIVADA de la Cobranza (migration 037): no requiere
// migración. Trabaja sobre `Receivable[]` con los abonos embebidos
// (`payments:receivable_payments(*)`) y agrega por moneda — nunca
// mezcla divisas, así que el reporte se renderiza para una moneda
// a la vez.
// ============================================================

import {
  type Receivable,
  type ReceivableStatus,
  RECEIVABLE_STATUSES,
} from "@/types";
import {
  isReceivableOverdue,
  paymentTotal,
  receivableBalance,
  receivableEffectiveStatus,
} from "./utils";

// ------------------------------------------------------------
// Antigüedad de saldos (aging)
// ------------------------------------------------------------
export type AgingKey = "current" | "d1_30" | "d31_60" | "d61_90" | "d90plus";

export const AGING_BUCKETS: Array<{ key: AgingKey; label: string; overdue: boolean }> = [
  { key: "current", label: "Por vencer", overdue: false },
  { key: "d1_30", label: "1–30 días", overdue: true },
  { key: "d31_60", label: "31–60 días", overdue: true },
  { key: "d61_90", label: "61–90 días", overdue: true },
  { key: "d90plus", label: "+90 días", overdue: true },
];

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Bucket de antigüedad de un saldo pendiente según su vencimiento. */
export function agingBucket(
  dueDate: string | null | undefined,
  todayIso: string,
): AgingKey {
  if (!dueDate || dueDate >= todayIso) return "current";
  const days = daysBetween(dueDate, todayIso);
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90plus";
}

// ------------------------------------------------------------
// Resultado
// ------------------------------------------------------------
export interface ReceivablesReport {
  totals: {
    invoiced: number;
    collected: number;
    pending: number;
    overdue: number;
    current: number;
    count: number;
    overdueCount: number;
    /** collected / invoiced, 0..1. */
    collectionRate: number;
  };
  byStatus: Array<{
    status: ReceivableStatus;
    label: string;
    count: number;
    amount: number;
    balance: number;
  }>;
  aging: Array<{ key: AgingKey; label: string; overdue: boolean; amount: number; count: number }>;
  monthly: Array<{ key: string; label: string; amount: number }>;
  byCounterparty: Array<{
    id: string;
    name: string;
    pending: number;
    overdue: number;
    count: number;
  }>;
}

/** Monedas presentes en los datos (ordenadas, en mayúsculas). */
export function currenciesIn(rows: Receivable[]): string[] {
  return [...new Set(rows.map((r) => (r.currency || "USD").toUpperCase()))].sort();
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("es-ES", { month: "short", timeZone: "UTC" });
}

/**
 * Agrega las cuentas por cobrar de UNA moneda en un reporte de cartera.
 * `rows` puede venir de cualquier moneda; aquí se filtra.
 */
export function buildReceivablesReport(
  rows: Receivable[],
  opts: { todayIso: string; currency: string; months?: number },
): ReceivablesReport {
  const currency = opts.currency.toUpperCase();
  const today = opts.todayIso;
  const months = opts.months ?? 6;

  const scoped = rows.filter((r) => (r.currency || "USD").toUpperCase() === currency);

  // byStatus sobre TODAS las filas (incluye anuladas, para el desglose).
  const byStatus = RECEIVABLE_STATUSES.map((s) => ({
    status: s.value,
    label: s.label,
    count: 0,
    amount: 0,
    balance: 0,
  }));
  const statusIndex = new Map(byStatus.map((b) => [b.status, b]));

  const agingMap = new Map<AgingKey, { amount: number; count: number }>(
    AGING_BUCKETS.map((b) => [b.key, { amount: 0, count: 0 }]),
  );
  const cpMap = new Map<
    string,
    { id: string; name: string; pending: number; overdue: number; count: number }
  >();

  let invoiced = 0;
  let collected = 0;
  let overdue = 0;
  let overdueCount = 0;
  let count = 0;

  for (const r of scoped) {
    const status = receivableEffectiveStatus(r);
    const amount = Number(r.amount) || 0;
    const paid = paymentTotal(r);
    const balance = receivableBalance(r);

    const sb = statusIndex.get(status);
    if (sb) {
      sb.count += 1;
      sb.amount += amount;
      sb.balance += balance;
    }

    if (status === "cancelled") continue;

    invoiced += amount;
    collected += paid;
    count += 1;

    if (balance > 0) {
      const bucket = agingBucket(r.due_date, today);
      const ab = agingMap.get(bucket);
      if (ab) {
        ab.amount += balance;
        ab.count += 1;
      }

      const isOverdue = isReceivableOverdue(r, today);
      if (isOverdue) {
        overdue += balance;
        overdueCount += 1;
      }

      const id = r.contact_id ?? r.organization_id ?? "__none__";
      const name = r.contact?.name ?? r.organization?.name ?? "Sin cliente";
      const cp = cpMap.get(id) ?? { id, name, pending: 0, overdue: 0, count: 0 };
      cp.pending += balance;
      if (isOverdue) cp.overdue += balance;
      cp.count += 1;
      cpMap.set(id, cp);
    }
  }

  // Tendencia mensual de abonos (últimos `months`).
  const monthKeys: string[] = [];
  const base = new Date(`${today}T00:00:00Z`);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    monthKeys.push(d.toISOString().slice(0, 7));
  }
  const monthMap = new Map(monthKeys.map((k) => [k, 0]));
  for (const r of scoped) {
    if (receivableEffectiveStatus(r) === "cancelled") continue;
    for (const p of r.payments ?? []) {
      const k = (p.paid_at || p.created_at || "").slice(0, 7);
      if (monthMap.has(k)) monthMap.set(k, (monthMap.get(k) ?? 0) + (Number(p.amount) || 0));
    }
  }

  const pendingTotal = invoiced - collected < 0 ? 0 : invoiced - collected;

  return {
    totals: {
      invoiced,
      collected,
      pending: pendingTotal,
      overdue,
      current: pendingTotal - overdue,
      count,
      overdueCount,
      collectionRate: invoiced > 0 ? collected / invoiced : 0,
    },
    byStatus,
    aging: AGING_BUCKETS.map((b) => ({
      key: b.key,
      label: b.label,
      overdue: b.overdue,
      amount: agingMap.get(b.key)?.amount ?? 0,
      count: agingMap.get(b.key)?.count ?? 0,
    })),
    monthly: monthKeys.map((k) => ({ key: k, label: monthLabel(k), amount: monthMap.get(k) ?? 0 })),
    byCounterparty: [...cpMap.values()].sort((a, b) => b.pending - a.pending),
  };
}
