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
  /**
   * 123 — momento del último reencolado (devolución a la cola o
   * transferencia vencida). Si existe, la espera se mide desde aquí.
   */
  queuedAt?: string | null;
  /** Segundos máximos de espera. `0` = sin expirar. */
  maxWaitSeconds: number;
  /** Reloj inyectable para tests. */
  now?: number;
}

/** Inicio real de la espera: el reencolado manda sobre el alta. */
function queueStart(context: QueueTimeoutContext): string {
  return context.queuedAt || context.startedAt;
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
  const started = new Date(queueStart(context)).getTime();
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
  const started = new Date(queueStart(context)).getTime();
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

/** Prioridad mínima de la cola (0 = normal). */
export const QUEUE_PRIORITY_MIN = 0;

/** Prioridad máxima de la cola (5 = la más urgente). */
export const QUEUE_PRIORITY_MAX = 5;

/**
 * Normaliza la prioridad de una entrante: entero 0..5; valores fuera
 * de rango o inválidos caen a 0 (normal).
 */
export function normalizeQueuePriority(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return QUEUE_PRIORITY_MIN;
  return Math.min(QUEUE_PRIORITY_MAX, Math.max(QUEUE_PRIORITY_MIN, n));
}

export interface QueueOrderEntry {
  priority: number;
  started_at: string;
}

/**
 * Orden de salida de la cola: primero la prioridad más alta y, dentro
 * de la misma prioridad, el orden de llegada (FIFO).
 */
export function compareQueueOrder(
  a: QueueOrderEntry,
  b: QueueOrderEntry
): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const startedA = new Date(a.started_at).getTime();
  const startedB = new Date(b.started_at).getTime();
  const diff = (startedA || 0) - (startedB || 0);
  if (diff !== 0) return diff;
  return 0;
}
