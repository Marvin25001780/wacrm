// ============================================================
// Lógica pura de una llamada: duración, resultado y estado final.
//
// Se separa del transporte (LiveKit) y de la base de datos para
// poder probarla sin red. La usan la API de fin de llamada y el
// webhook, de modo que colgar desde el navegador o perder la
// conexión terminen en el mismo cálculo.
// ============================================================

import type { CallDirection, CallResult, CallSessionStatus } from '@/types';

/** Prefijo de las salas que crea este CRM. */
export const CALL_ROOM_PREFIX = 'crm-call-';

/** Nombre de sala único y reconocible. `random` inyectable en pruebas. */
export function newCallRoomName(
  random: () => string = () => crypto.randomUUID()
): string {
  return `${CALL_ROOM_PREFIX}${random()}`;
}

export function isTelephonyRoom(roomName: string | null | undefined): boolean {
  return Boolean(roomName && roomName.startsWith(CALL_ROOM_PREFIX));
}

const TERMINAL_STATUSES: CallSessionStatus[] = [
  'ended',
  'missed',
  'failed',
  'cancelled',
];

export function isTerminalCallStatus(status: CallSessionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Segundos hablados: desde que se contestó hasta que se colgó. */
export function talkDurationSeconds(
  answeredAt: string | null | undefined,
  endedAt: string | null | undefined
): number | null {
  if (!answeredAt || !endedAt) return null;
  const start = new Date(answeredAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

/** Duración para mostrar: `0:07`, `4:31`, `1:02:09`. */
export function formatCallDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export type HangupReason =
  'hangup' | 'declined' | 'failed' | 'timeout' | 'agent_left';

/**
 * Estado final al cerrar una sesión. Si nunca se contestó, una
 * saliente queda como "perdida" y una entrante como "perdida"
 * también; `failed` solo cuando el transporte falló de verdad.
 */
export function resolveHangupStatus(args: {
  answeredAt: string | null | undefined;
  reason?: HangupReason | null;
}): CallSessionStatus {
  if (args.reason === 'failed') return 'failed';
  if (args.answeredAt) return 'ended';
  if (args.reason === 'declined') return 'cancelled';
  return 'missed';
}

/** Resultado que se guarda en la actividad de CRM. */
export function callResultForStatus(
  status: CallSessionStatus,
  answeredAt: string | null | undefined
): CallResult {
  if (answeredAt) return 'answered';
  if (status === 'failed') return 'failed';
  return 'no_answer';
}

/** Minutos enteros para `activities.duration_minutes` (mínimo 1). */
export function callDurationMinutes(
  seconds: number | null | undefined
): number {
  if (!seconds || seconds <= 0) return 1;
  return Math.max(1, Math.ceil(seconds / 60));
}

/** Asunto legible de la actividad que alimenta /metrics/llamadas. */
export function callSubject(args: {
  direction: CallDirection;
  number: string | null | undefined;
  contactName?: string | null;
}): string {
  const who =
    args.contactName?.trim() || args.number?.trim() || 'número desconocido';
  return args.direction === 'inbound'
    ? `Llamada entrante de ${who}`
    : `Llamada saliente a ${who}`;
}

/** Motivos aceptados por la API de fin de llamada. */
export function normalizeHangupReason(value: unknown): HangupReason {
  if (
    value === 'declined' ||
    value === 'failed' ||
    value === 'timeout' ||
    value === 'agent_left'
  ) {
    return value;
  }
  return 'hangup';
}
