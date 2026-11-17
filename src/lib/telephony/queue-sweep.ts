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
import { isQueueExpired } from './queue';
import { isSkillOverflowDue } from './skills';
import type { CallSession } from '@/types';

export interface QueueSweepResult {
  /** Entrantes que excedieron el máximo y fueron cerrados. */
  closed: CallSession[];
}

export interface SkillOverflowResult {
  /** Entrantes cuyo requisito de habilidad se levantó. */
  overflowed: CallSession[];
}

const SWEEP_LIMIT = 50;

/**
 * Cierra las entrantes que llevan más tiempo esperando que el máximo
 * del negocio. Solo toca llamadas sin agente asignado (si un agente
 * reclamó, es suya) y nunca toca las ya terminales.
 *
 * Incluye las llamadas devueltas a la cola por una transferencia
 * (migración 123): siguen en `active` porque el cliente ya fue
 * atendido una vez, y su espera se mide desde `queued_at`. Si vencen,
 * se cierran como `ended` (no como perdidas: sí hubo conversación).
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

  const { data, error } = await args.db
    .from('call_sessions')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('direction', 'inbound')
    .in('status', ['ringing', 'active'])
    .is('agent_user_id', null)
    .order('started_at', { ascending: true })
    .limit(SWEEP_LIMIT);

  if (error) {
    // Sin tabla de llamadas (112 sin aplicar) o RLS: se ignora el barrido.
    console.warn('[telephony] barrido de cola sin resultados:', error.message);
    return { closed: [] };
  }

  const expired = ((data ?? []) as CallSession[])
    .filter((call) =>
      isQueueExpired({
        startedAt: call.started_at,
        queuedAt: call.queued_at,
        maxWaitSeconds,
        now: nowMs,
      })
    )
    .slice(0, SWEEP_LIMIT);
  const closed: CallSession[] = [];

  for (const call of expired) {
    try {
      const result = await finalizeCall({
        db: args.db,
        call,
        reason: 'timeout',
        createActivity: false,
        guard: { status: call.status, agent_user_id: null },
      });

      // `missed` = nunca se contestó; `ended` = se contestó y volvió a
      // la cola por una transferencia.
      if (result.status !== 'missed' && result.status !== 'ended') continue;

      await args.db.from('call_events').insert({
        account_id: args.accountId,
        call_id: call.id,
        type: 'queue_timeout',
        payload: {
          reason: 'timeout',
          status: result.status,
          max_wait_seconds: maxWaitSeconds,
          queued_at: call.queued_at,
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

/**
 * Desbordamiento por habilidad (119): si la entrante exige
 * habilidades y nadie con ellas la tomó en `overflowSeconds`, se
 * levanta el requisito para que cualquier agente disponible pueda
 * reclamarla. No cierra la llamada ni le asigna agente: solo quita
 * la restricción y deja el evento `skill_overflow`.
 *
 * El guard del UPDATE exige que siga sonando, sin agente y sin
 * desbordar, para no pisar una reclamación que ocurra en paralelo.
 */
export async function sweepSkillOverflow(args: {
  db: SupabaseClient;
  accountId: string;
  /** Segundos antes de levantar el requisito; `0` = desactivado. */
  overflowSeconds: number;
  /** Reloj inyectable para tests. */
  now?: number;
}): Promise<SkillOverflowResult> {
  const overflowSeconds = args.overflowSeconds ?? 0;
  if (overflowSeconds <= 0) return { overflowed: [] };

  const nowMs = args.now ?? Date.now();

  const { data, error } = await args.db
    .from('call_sessions')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('direction', 'inbound')
    .in('status', ['ringing', 'active'])
    .is('agent_user_id', null)
    .is('overflowed_at', null)
    .order('started_at', { ascending: true })
    .limit(SWEEP_LIMIT);

  if (error) {
    // Sin la 119 aplicada la columna `overflowed_at` no existe: el
    // desbordamiento simplemente no corre.
    console.warn(
      '[telephony] barrido de habilidades sin resultados:',
      error.message
    );
    return { overflowed: [] };
  }

  const candidates = ((data ?? []) as CallSession[]).filter(
    (call) =>
      (call.required_skills ?? []).length > 0 &&
      isSkillOverflowDue({
        // 123 — si la llamada volvió a la cola, el desbordamiento se
        // cuenta desde el reencolado, no desde el alta original.
        startedAt: call.queued_at ?? call.started_at,
        overflowSeconds,
        now: nowMs,
      })
  );

  const overflowedAt = new Date(nowMs).toISOString();
  const overflowed: CallSession[] = [];

  for (const call of candidates) {
    const { data: updated, error: updateError } = await args.db
      .from('call_sessions')
      .update({ overflowed_at: overflowedAt })
      .eq('id', call.id)
      .eq('status', 'ringing')
      .is('agent_user_id', null)
      .is('overflowed_at', null)
      .select('*')
      .maybeSingle();

    if (updateError) {
      console.error('[telephony] desbordamiento de habilidad falló:', call.id, updateError);
      continue;
    }
    if (!updated) continue; // otro proceso la reclamó o ya desbordó

    await args.db.from('call_events').insert({
      account_id: args.accountId,
      call_id: call.id,
      type: 'skill_overflow',
      payload: {
        required_skills: call.required_skills ?? [],
        overflow_seconds: overflowSeconds,
      },
    });

    overflowed.push(updated as CallSession);
  }

  return { overflowed };
}
