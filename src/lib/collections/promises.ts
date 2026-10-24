import type { CollectionPromiseStatus } from "@/types/collections";

const TRANSITIONS: Record<CollectionPromiseStatus, CollectionPromiseStatus[]> = {
  pending: ["kept", "partial", "broken", "cancelled"],
  partial: ["kept", "broken", "cancelled"],
  kept: [],
  broken: [],
  cancelled: [],
};

export function canTransitionPromise(
  from: CollectionPromiseStatus,
  to: CollectionPromiseStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Estado que corresponde a un pago parcial/total. */
export function promiseStatusForPayment(
  amount: number,
  paidAmount: number,
): "pending" | "partial" | "kept" {
  if (paidAmount >= amount - 0.005) return "kept";
  if (paidAmount > 0) return "partial";
  return "pending";
}
