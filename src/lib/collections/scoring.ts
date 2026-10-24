/**
 * Motor de prioridad por reglas transparentes.
 *
 * Debe coincidir con `collection_recompute_priorities` (migración
 * 076). La UI usa esta versión solo para pruebas y para explicar el
 * score; la fuente de verdad es la base de datos.
 */
export interface PriorityInput {
  daysOverdue: number;
  overdueBalance: number;
  maxOverdueBalance: number;
  promisesKept: number;
  promisesResolved: number;
  actionsContacted: number;
  actionsTotal: number;
  /** 1 = dentro de la ventana horaria, 0.5 = sin datos. */
  timeWindowFit?: number;
}

export function computePriority(input: PriorityInput): number {
  const urgency = Math.min(Math.max(input.daysOverdue, 0) / 120, 1);
  const value =
    input.maxOverdueBalance > 0
      ? Math.min(Math.max(input.overdueBalance, 0) / input.maxOverdueBalance, 1)
      : 0;
  const propensity =
    input.promisesResolved > 0 ? input.promisesKept / input.promisesResolved : 0.5;
  const contactability =
    input.actionsTotal > 0 ? input.actionsContacted / input.actionsTotal : 0.5;
  const windowFit = input.timeWindowFit ?? 0.5;

  const score =
    35 * urgency +
    25 * value +
    20 * propensity +
    15 * contactability +
    5 * windowFit;

  return Math.round(Math.min(Math.max(score, 0), 100) * 100) / 100;
}

export function priorityReason(input: PriorityInput): string {
  const parts = [
    input.daysOverdue > 0 ? `Mora ${input.daysOverdue}d` : "Sin mora",
    `Saldo vencido USD ${input.overdueBalance.toFixed(2)}`,
    `${input.actionsContacted}/${input.actionsTotal} gestiones contestadas`,
    `${input.promisesKept} PTP cumplidas`,
  ];
  return parts.join(" · ");
}
