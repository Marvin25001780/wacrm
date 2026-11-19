// ============================================================
// Operación en vivo (bloque 124) — reglas puras del panel.
//
// No hay cambios de esquema: el panel lee lo que ya existe (cola,
// presencia, bitácora de estados y transferencias de la 123).
//
// SLA v1 (documentado en docs/telefonia-livekit.md):
//   - El objetivo es la espera máxima del negocio
//     (`queue_max_wait_seconds`). `0` = sin límite, así que no hay
//     alertas de SLA.
//   - "Por vencer" al 80 % del máximo (SLA_AT_RISK_RATIO).
//   - "Vencida" al llegar al máximo; el barrido la retira en la
//     siguiente pasada.
//
// Los umbrales de pausa y cierre son fijos en el código (no hay
// interruptores que aparenten configurar algo que no existe).
// ============================================================

import type { AgentStatus } from '@/types';
import { TRANSFER_RING_TIMEOUT_DEFAULT } from './transfers';

/** Proporción del máximo de espera a partir de la cual se avisa. */
export const SLA_AT_RISK_RATIO = 0.8;

/** Pausa que el panel marca como larga (20 minutos). */
export const LONG_BREAK_SECONDS = 20 * 60;

/** Cierre (wrap-up) que el panel marca como largo (5 minutos). */
export const LONG_WRAP_UP_SECONDS = 5 * 60;

export type QueueSlaState = 'none' | 'ok' | 'at_risk' | 'expired';

/**
 * Segundos transcurridos desde un instante ISO. `null` cuando el
 * valor falta o no es una fecha válida (no se inventa un tiempo).
 */
export function secondsSince(
  iso: string | null | undefined,
  now: number = Date.now()
): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - ms) / 1000));
}

/**
 * Clasifica la espera de una llamada en cola contra el SLA.
 * `maxWaitSeconds = 0` significa sin límite: no hay estado de SLA.
 */
export function queueSlaState(args: {
  waitSeconds: number;
  maxWaitSeconds: number;
}): QueueSlaState {
  const max = Math.floor(args.maxWaitSeconds ?? 0);
  if (!Number.isFinite(max) || max <= 0) return 'none';

  const wait = Math.max(0, Math.floor(args.waitSeconds ?? 0));
  if (wait >= max) return 'expired';
  if (wait >= Math.ceil(max * SLA_AT_RISK_RATIO)) return 'at_risk';
  return 'ok';
}

export function queueSlaLabel(state: QueueSlaState): string {
  switch (state) {
    case 'none':
      return 'Sin límite';
    case 'at_risk':
      return 'Por vencer';
    case 'expired':
      return 'Vencida';
    default:
      return 'En tiempo';
  }
}

/**
 * Espera real de una llamada en cola. A diferencia de
 * `queueWaitSeconds` (que devuelve 0 sin límite, porque no hay nada
 * que expirar), aquí siempre se mide el reloj: el supervisor necesita
 * ver cuánto lleva esperando aunque el negocio no tenga tope.
 */
export function queueWaitRealSeconds(args: {
  startedAt: string;
  queuedAt?: string | null;
  now?: number;
}): number {
  return (
    secondsSince(args.queuedAt || args.startedAt, args.now ?? Date.now()) ?? 0
  );
}

/** ¿El estado actual ya dura demasiado como para no mirarlo? */
export function isLongStatus(args: {
  status: AgentStatus | string;
  seconds: number | null | undefined;
}): boolean {
  const seconds = args.seconds;
  if (seconds == null || !Number.isFinite(seconds)) return false;
  if (args.status === 'break') return seconds >= LONG_BREAK_SECONDS;
  if (args.status === 'wrap_up') return seconds >= LONG_WRAP_UP_SECONDS;
  return false;
}

/**
 * Segundos que le quedan al timbre de una transferencia. Negativo =
 * ya venció (el barrido la devuelve a la cola en la siguiente pasada).
 * `null` si la marca de tiempo no es válida.
 */
export function transferSecondsLeft(args: {
  transferAt: string;
  timeoutSeconds: number | null | undefined;
  now?: number;
}): number | null {
  const started = Date.parse(args.transferAt);
  if (!Number.isFinite(started)) return null;

  const timeout =
    args.timeoutSeconds && args.timeoutSeconds > 0
      ? args.timeoutSeconds
      : TRANSFER_RING_TIMEOUT_DEFAULT;
  const now = args.now ?? Date.now();
  return Math.ceil((started + timeout * 1000 - now) / 1000);
}

/** La espera más larga de la cola, para el indicador principal. */
export function longestWaitSeconds(
  waits: readonly number[] | null | undefined
): number {
  if (!waits || waits.length === 0) return 0;
  return waits.reduce((max, value) => (value > max ? value : max), 0);
}
