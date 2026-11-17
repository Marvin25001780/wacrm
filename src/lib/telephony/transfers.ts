// ============================================================
// Transferencias internas (migración 123).
//
// Un agente pasa la llamada en curso a otro agente del negocio o la
// devuelve a la cola. La sala de LiveKit no se cierra: cambia el
// agente asignado. Si el nuevo agente no contesta en el tiempo
// configurado, la llamada vuelve a la cola sin cerrarse.
//
// La lógica pura (límites, vencimiento y validaciones) vive aquí
// para poder probarla sin base de datos ni LiveKit.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CallSession } from '@/types';

/** Timbre de una transferencia: 25 s por defecto. */
export const TRANSFER_RING_TIMEOUT_DEFAULT = 25;
/** Transferencias máximas por llamada antes de bloquear. */
export const MAX_TRANSFERS_DEFAULT = 3;

export const TRANSFER_RING_TIMEOUT_MIN = 5;
export const TRANSFER_RING_TIMEOUT_MAX = 300;
export const MAX_TRANSFERS_LIMIT = 10;

/**
 * Valida el timbre de transferencia (5–300 s). Devuelve `null` si el
 * valor no sirve para guardarlo.
 */
export function normalizeTransferRingTimeout(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return null;
  if (n < TRANSFER_RING_TIMEOUT_MIN || n > TRANSFER_RING_TIMEOUT_MAX) {
    return null;
  }
  return n;
}

/**
 * Valida el máximo de transferencias por llamada (0–10).
 * `0` = sin límite.
 */
export function normalizeMaxTransfers(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > MAX_TRANSFERS_LIMIT) return null;
  return n;
}

export interface TransferBlock {
  ok: boolean;
  reason?: string;
}

/**
 * ¿Se puede transferir esta llamada? Solo una llamada `active`, y
 * respetando el tope de transferencias del negocio.
 */
export function canTransferCall(args: {
  status: string;
  transferCount: number | null | undefined;
  maxTransfers: number;
}): TransferBlock {
  if (args.status !== 'active') {
    return {
      ok: false,
      reason: 'Solo se puede transferir una llamada en curso.',
    };
  }
  const max = args.maxTransfers;
  if (max > 0 && (args.transferCount ?? 0) >= max) {
    return {
      ok: false,
      reason: `La llamada alcanzó el máximo de ${max} transferencias. Devuélvela a la cola o termínala.`,
    };
  }
  return { ok: true };
}

/** La llamada está sonando en un agente por una transferencia. */
export function isTransferPending(
  call: Pick<CallSession, 'status' | 'transfer_at'> | null | undefined
): boolean {
  return Boolean(call && call.status === 'ringing' && call.transfer_at);
}

/**
 * Momento en que vence el timbre de la transferencia. `null` si la
 * llamada no está en transferencia.
 */
export function transferDeadline(
  call: Pick<
    CallSession,
    'status' | 'transfer_at' | 'transfer_timeout_seconds'
  > | null | undefined
): number | null {
  if (!isTransferPending(call) || !call?.transfer_at) return null;
  const started = Date.parse(call.transfer_at);
  if (!Number.isFinite(started)) return null;
  const seconds =
    call.transfer_timeout_seconds && call.transfer_timeout_seconds > 0
      ? call.transfer_timeout_seconds
      : TRANSFER_RING_TIMEOUT_DEFAULT;
  return started + seconds * 1000;
}

/** ¿La transferencia ya venció? */
export function isTransferExpired(
  call: Pick<
    CallSession,
    'status' | 'transfer_at' | 'transfer_timeout_seconds'
  > | null | undefined,
  now: number = Date.now()
): boolean {
  const deadline = transferDeadline(call);
  return deadline !== null && deadline <= now;
}

/**
 * Motivo por el que un agente no puede recibir la transferencia.
 * `null` = puede recibirla.
 */
export function transferTargetBlockReason(args: {
  userId: string;
  callerUserId: string;
  role: string;
  agentStatus: string;
  hasLiveCall: boolean;
}): string | null {
  if (args.userId === args.callerUserId) return 'No puedes transferirte a ti mismo.';
  if (args.role === 'viewer') return 'Ese miembro no atiende llamadas.';
  if (args.agentStatus !== 'available') {
    return 'Ese agente no está disponible.';
  }
  if (args.hasLiveCall) return 'Ese agente ya tiene una llamada.';
  return null;
}

export interface TransferReleaseResult {
  /** Llamadas devueltas a la cola por timbre vencido. */
  released: CallSession[];
  /** La 123 no está aplicada (RPC ausente). */
  migrationMissing: boolean;
}

/**
 * Barrido perezoso: devuelve a la cola las transferencias que nadie
 * contestó. Corre desde el estado del softphone y desde el panel de
 * supervisión. No cierra la llamada: el cliente sigue esperando.
 *
 * Si la 123 no está aplicada, la RPC no existe y el barrido se
 * ignora (la telefonía sigue funcionando como antes).
 */
export async function releaseExpiredTransfers(args: {
  db: SupabaseClient;
  accountId: string;
}): Promise<TransferReleaseResult> {
  const rpc = await args.db.rpc('release_expired_transfers', {
    p_account_id: args.accountId,
  });

  if (rpc.error) {
    const migrationMissing =
      rpc.error.code === 'PGRST202' || rpc.error.code === '42883';
    if (!migrationMissing) {
      console.warn(
        '[telephony] barrido de transferencias falló:',
        rpc.error.message
      );
    }
    return { released: [], migrationMissing };
  }

  const released = (rpc.data ?? []) as CallSession[];
  if (released.length === 0) return { released, migrationMissing: false };

  const events = released.map((call) => ({
    account_id: args.accountId,
    call_id: call.id,
    type: 'transfer_timeout',
    payload: {
      from_user_id: call.transfer_from_user_id,
      queued_at: call.queued_at,
    },
  }));
  const { error: eventError } = await args.db.from('call_events').insert(events);
  if (eventError) {
    console.warn(
      '[telephony] no se pudo registrar el timeout de transferencia:',
      eventError.message
    );
  }

  return { released, migrationMissing: false };
}
