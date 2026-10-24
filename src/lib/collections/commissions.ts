/** Comisión simple sobre el monto recuperado. */
export function commissionFor(recovered: number, percentage: number): number {
  const amount = Number(recovered) || 0;
  const pct = Number(percentage) || 0;
  return Math.round(amount * pct) / 100;
}
