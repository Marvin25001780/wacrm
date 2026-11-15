// ============================================================
// Barrido de la cola (ACD v1): retira entrantes que excedieron
// la espera máxima configurada para el negocio.
//
// Corre de forma perezosa desde el estado del softphone y desde el
// panel de supervisión, así la cola no se acumula aunque nadie
// consulte manualmente. Un entrante en espera se cierra como
// `missed` con motivo `timeout` (evento `queue_timeout`) y su sala de
// LiveKit se libera.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { closeCallRoom } from './livekit';
import { finalizeCall } from './finalize';
import type { CallSession } from '@/types';

export interface QueueSweepResult {
  /** Entrantes que excedieron el máximo y fueron cerrados. */
  closed: CallSession[];
}

const SWEEP_LIMIT = 50;

/**
 * Cierra las entrantes que llevan más tiempo sonando que el máximo
 * del negocio. Solo toca llamadas sin agente asignado en `ringing`
 * (si un agente reclamó, es suya) y nunca toca las ya terminales.
 */
export async function sweepExpiredQueue(args: {
  db: SupabaseClient;
  accountId: string;
  /** Segundos de espera máxima; `0` = sin límite. */
  maxWaitSeconds: number;
  /** Reloj inyectable para tests. */
  now?: number;
}): Promise<QueueSweepResult> {
  const maxWaitSeconds = args.maxWaitSeconds ?? 0;
  if (maxWaitSeconds <= 0) {
    return { closed: [] };
  }

  const nowMs = args.now ?? Date.now();
  const cutoff = new Date(nowMs - maxWaitSeconds * 1000).toISOString();

  const { data, error } = await args.db
    .from('call_sessions')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('direction', 'inbound')
    .eq('status', 'ringing')
    .is('agent_user_id', null)
    .lt('started_at', cutoff)
    .limit(SWEEP_LIMIT);

  if (error) {
    // Sin tabla de llamadas (112 sin aplicar) o RLS: se ignora el barrido.
    console.warn('[telephony] barrido de cola sin resultados:', error.message);
    return { closed: [] };
  }

  const expired = ((data ?? []) as CallSession[]).slice(0, SWEEP_LIMIT);
  const closed: CallSession[] = [];

  for (const call of expired) {
    try {
      const result = await finalizeCall({
        db: args.db,
        call,
        reason: 'timeout',
        createActivity: false,
        guard: { status: 'ringing', agent_user_id: null },
      });

      if (result.status !== 'missed') continue;

      await args.db.from('call_events').insert({
        account_id: args.accountId,
        call_id: call.id,
        type: 'queue_timeout',
        payload: {
          reason: 'timeout',
          status: result.status,
          max_wait_seconds: maxWaitSeconds,
        },
      });

      closed.push(call);
      await closeCallRoom(call.room_name).catch(() => undefined);
    } catch (err) {
      console.error('[telephony] timeout de cola falló:', call.id, err);
    }
  }

  return { closed };
}
