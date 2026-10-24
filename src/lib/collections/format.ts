import type {
  CollectionDebtorStatus,
  CollectionInstallmentStatus,
  CollectionPromiseStatus,
  CollectionSegment,
} from "@/types/collections";

/** Diferencia en días calendario entre dos fechas ISO (YYYY-MM-DD). */
export function calendarDaysBetween(fromIso: string, toIso: string): number {
  const from = isoToUtc(fromIso);
  const to = isoToUtc(toIso);
  return Math.floor((to - from) / 86_400_000);
}

function isoToUtc(value: string): number {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
}

/** Días de mora (0 si aún no vence). */
export function daysOverdue(dueDate: string, today = todayIso()): number {
  return Math.max(0, calendarDaysBetween(dueDate, today));
}

/** Fecha de hoy en la zona horaria de la operación (Venezuela). */
export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatUsd(value: number | null | undefined): string {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export function formatPercent(value: number | null | undefined): string {
  return `${(Number(value) || 0).toFixed(1)}%`;
}

export function installmentBalance(installment: {
  total: number;
  paid_amount: number;
}): number {
  return Math.max(0, (Number(installment.total) || 0) - (Number(installment.paid_amount) || 0));
}

export function isInstallmentOverdue(
  installment: { status: string; due_date: string },
  today = todayIso(),
): boolean {
  return (
    (installment.status === "pending" || installment.status === "partial") &&
    installment.due_date < today
  );
}

export const DEBTOR_STATUS_TONE: Record<CollectionDebtorStatus, string> = {
  nuevo: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  contactado: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  negociacion: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  acuerdo: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  pagado: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  ilocalizable: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  juridico: "border-red-500/40 bg-red-500/10 text-red-300",
};

export const SEGMENT_TONE: Record<CollectionSegment, string> = {
  preventiva: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  temprana: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  media: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  tardia: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  critica: "border-red-500/40 bg-red-500/10 text-red-300",
};

export const INSTALLMENT_STATUS_TONE: Record<CollectionInstallmentStatus, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  partial: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  cancelled: "border-border bg-muted text-muted-foreground",
};

export const PROMISE_STATUS_TONE: Record<CollectionPromiseStatus, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  kept: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  partial: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  broken: "border-red-500/40 bg-red-500/10 text-red-300",
  cancelled: "border-border bg-muted text-muted-foreground",
};
