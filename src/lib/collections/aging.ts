import type { CollectionInstallment } from "@/types/collections";

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

type AgingInstallment = Pick<
  CollectionInstallment,
  "total" | "paid_amount" | "status" | "due_date"
>;

function utcDay(value: string): number {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
}

/**
 * Agrupa el saldo pendiente por antigüedad de vencimiento.
 * `today` debe venir en formato YYYY-MM-DD.
 */
export function buildAging(
  installments: AgingInstallment[],
  today: string,
): AgingBuckets {
  const buckets: AgingBuckets = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    total: 0,
  };

  const todayMs = utcDay(today);

  for (const installment of installments) {
    if (installment.status !== "pending" && installment.status !== "partial") {
      continue;
    }

    const balance = Math.max(
      0,
      (Number(installment.total) || 0) - (Number(installment.paid_amount) || 0),
    );
    if (balance === 0) continue;

    const days = Math.floor((todayMs - utcDay(installment.due_date)) / 86_400_000);

    if (days <= 0) buckets.current += balance;
    else if (days <= 30) buckets.d1_30 += balance;
    else if (days <= 60) buckets.d31_60 += balance;
    else if (days <= 90) buckets.d61_90 += balance;
    else buckets.d90_plus += balance;

    buckets.total += balance;
  }

  return buckets;
}

export function agingRows(buckets: AgingBuckets) {
  return [
    { key: "current", label: "Al día", value: buckets.current },
    { key: "d1_30", label: "1-30 días", value: buckets.d1_30 },
    { key: "d31_60", label: "31-60 días", value: buckets.d31_60 },
    { key: "d61_90", label: "61-90 días", value: buckets.d61_90 },
    { key: "d90_plus", label: "90+ días", value: buckets.d90_plus },
  ];
}
