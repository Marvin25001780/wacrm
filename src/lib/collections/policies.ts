import type { CollectionPolicy } from "@/types/collections";

export interface PromiseInput {
  amount: number;
  dueDate: string;
  balance: number;
}

export interface PolicyLike
  extends Pick<
    CollectionPolicy,
    | "ptp_max_days"
    | "min_down_payment_pct"
    | "max_discount_pct"
    | "max_attempts_per_day"
    | "allowed_start"
    | "allowed_end"
  > {}

function utcDay(value: string): number {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
}

/** Valida una PTP contra la política del tramo. Devuelve errores legibles. */
export function validatePromise(
  input: PromiseInput,
  policy: PolicyLike,
  today: string,
): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    errors.push("El monto de la promesa debe ser mayor que cero.");
  }

  if (!input.dueDate) {
    errors.push("La fecha de la promesa es obligatoria.");
  } else {
    const days = Math.floor((utcDay(input.dueDate) - utcDay(today)) / 86_400_000);
    if (days < 0) {
      errors.push("La fecha de la promesa no puede estar en el pasado.");
    } else if (days > policy.ptp_max_days) {
      errors.push(
        `La política de este tramo permite promesas de hasta ${policy.ptp_max_days} días.`,
      );
    }
  }

  const minDown = (input.balance * policy.min_down_payment_pct) / 100;
  if (input.amount < minDown - 0.005) {
    errors.push(
      `El abono mínimo para este tramo es USD ${minDown.toFixed(2)} (${policy.min_down_payment_pct}%).`,
    );
  }

  return errors;
}

export function validateDiscount(
  discountPct: number,
  policy: PolicyLike,
): string | null {
  if (discountPct < 0 || discountPct > 100) {
    return "El descuento debe estar entre 0% y 100%.";
  }
  if (discountPct > policy.max_discount_pct) {
    return `La política permite un descuento máximo de ${policy.max_discount_pct}%.`;
  }
  return null;
}

export function validateAttempts(
  attemptsToday: number,
  policy: PolicyLike,
): string | null {
  if (attemptsToday >= policy.max_attempts_per_day) {
    return `Se alcanzó el máximo de ${policy.max_attempts_per_day} intentos por día para este tramo.`;
  }
  return null;
}

/**
 * Comprueba la hora local contra la ventana permitida. La zona
 * horaria se resuelve en el servidor con `collection_settings`; esta
 * función recibe la hora ya convertida (HH:MM).
 */
export function isWithinBusinessHours(
  time: string,
  policy: PolicyLike,
): boolean {
  return time >= policy.allowed_start && time <= policy.allowed_end;
}
