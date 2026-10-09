// ============================================================
// Utilidades de Cobranza (migration 037).
// Saldo, estado efectivo y vencimiento — puro, sin dependencias.
// El estado pending/partial/paid también lo mantiene un trigger en
// la BD; aquí se recalcula en el cliente para render inmediato y
// para la vista derivada "vencida".
// ============================================================

import { type Receivable, type ReceivableStatus } from '@/types';

/** Suma de los abonos embebidos. */
export function paymentTotal(r: Pick<Receivable, 'payments'>): number {
  return (r.payments ?? []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
}

/** Saldo pendiente (monto − abonos). Nunca negativo. */
export function receivableBalance(r: Pick<Receivable, 'amount' | 'payments'>): number {
  const balance = (Number(r.amount) || 0) - paymentTotal(r);
  return balance < 0 ? 0 : balance;
}

/** Estado efectivo recalculado desde los abonos. */
export function receivableEffectiveStatus(
  r: Pick<Receivable, 'status' | 'amount' | 'payments'>,
): ReceivableStatus {
  if (r.status === 'cancelled') return 'cancelled';
  const paid = paymentTotal(r);
  const amount = Number(r.amount) || 0;
  if (amount > 0 && paid >= amount) return 'paid';
  if (paid > 0) return 'partial';
  return 'pending';
}

/** Vencida = saldo pendiente con fecha de vencimiento pasada. */
export function isReceivableOverdue(
  r: Pick<Receivable, 'status' | 'amount' | 'payments' | 'due_date'>,
  todayIso: string,
): boolean {
  const status = receivableEffectiveStatus(r);
  if (status === 'paid' || status === 'cancelled') return false;
  if (!r.due_date) return false;
  return r.due_date < todayIso;
}

/** Fecha de hoy como YYYY-MM-DD (comparación lexicográfica con `due_date`). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
