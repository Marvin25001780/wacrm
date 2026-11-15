// ============================================================
// Lógica pura de la cola de llamadas entrantes (ACD v1).
//
// Se separa del transporte (LiveKit) y de la base de datos para
// poder probarla sin red. La usan el barrido de la cola, el softphone
// y los reportes.
// ============================================================

/** Espera máxima en cola; `0` = sin límite (espera indefinida). */
export const QUEUE_MAX_WAIT_SECONDS = 60;

export interface QueueTimeoutContext {
  startedAt: string;
  /** Segundos máximos de espera. `0` = sin expirar. */
  maxWaitSeconds: number;
  /** Reloj inyectable para tests. */
  now?: number;
}

/**
 * Segundos que la llamada ha estado sonando en la cola. Con
 * `maxWaitSeconds = 0` no acumula espera (espera indefinida).
 */
export function queueWaitSeconds(
  context: QueueTimeoutContext
): number {
  const maxWaitSeconds = context.maxWaitSeconds ?? 0;
  if (maxWaitSeconds <= 0) return 0;
  const started = new Date(context.startedAt).getTime();
  const now = context.now ?? Date.now();
  if (Number.isNaN(started) || Number.isNaN(now)) return 0;
  return Math.max(0, Math.floor((now - started) / 1000));
}

/**
 * ¿La entrante debe pasar a la siguiente fase (timeout de cola)?
 * `maxWaitSeconds = 0` significa "sin límite".
 */
export function isQueueExpired(context: QueueTimeoutContext): boolean {
  const maxWaitSeconds = context.maxWaitSeconds ?? 0;
  if (maxWaitSeconds <= 0) return false;
  const started = new Date(context.startedAt).getTime();
  const now = context.now ?? Date.now();
  if (Number.isNaN(started) || Number.isNaN(now)) return false;
  return Math.floor((now - started) / 1000) >= maxWaitSeconds;
}

/** Deadline ISO en el que la entrante expira (null si no hay límite). */
export function queueDeadlineIso(
  startedAt: string,
  maxWaitSeconds: number
): string | null {
  const seconds = maxWaitSeconds ?? 0;
  if (seconds <= 0) return null;
  const started = new Date(startedAt).getTime();
  const deadline = started + seconds * 1000;
  if (Number.isNaN(deadline)) return null;
  return new Date(deadline).toISOString();
}
