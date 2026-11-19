// ============================================================
// Cierre de una llamada — un solo camino para navegador y webhook.
//
// Al colgar se actualiza la sesión, se escribe la actividad de CRM
// (que es la fuente de /metrics/llamadas) y se deja un evento en la
// bitácora. Es idempotente: si el webhook y el navegador cierran a
// la vez, la segunda pasada no duplica la actividad.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CallSessionStatus } from '@/types';
import { callResultLabel } from '@/types';
import {
  callDurationMinutes,
  callResultForStatus,
  callSubject,
  formatCallDuration,
  isTerminalCallStatus,
  resolveHangupStatus,
  talkDurationSeconds,
  type HangupReason,
} from './calls';

export interface FinalizableCall {
  id: string;
  account_id: string;
  direction: 'inbound' | 'outbound';
  from_number: string | null;
  to_number: string | null;
  contact_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  agent_profile_id: string | null;
  agent_user_id: string | null;
  answered_at: string | null;
  status: CallSessionStatus;
  activity_id: string | null;
  transcript?: string | null;
  /** Metadata de la sesión (p. ej. campaña a la que pertenece la llamada). */
  metadata?: Record<string, unknown> | null;
}

export interface FinalizeResult {
  status: CallSessionStatus;
  durationSeconds: number | null;
  activityId: string | null;
  alreadyClosed: boolean;
}

export async function finalizeCall(args: {
  db: SupabaseClient;
  call: FinalizableCall;
  reason?: HangupReason;
  endedAt?: string;
  contactName?: string | null;
  /** false para flujos donde no hay agente (p. ej. entrante perdida). */
  createActivity?: boolean;
  /**
   * Condiciones que deben seguir cumplirse al cerrar. Las usa el
   * barrido de cola: solo cierra si la entrante sigue sin agente y
   * sonando (la reclamación atómica de un agente la protege).
   */
  guard?: {
    status?: CallSessionStatus;
    agent_user_id?: string | null;
  };
}): Promise<FinalizeResult> {
  const { db, call } = args;
  const endedAt = args.endedAt ?? new Date().toISOString();

  if (isTerminalCallStatus(call.status) && call.activity_id) {
    return {
      status: call.status,
      durationSeconds: talkDurationSeconds(call.answered_at, endedAt),
      activityId: call.activity_id,
      alreadyClosed: true,
    };
  }

  const status = isTerminalCallStatus(call.status)
    ? call.status
    : resolveHangupStatus({
        answeredAt: call.answered_at,
        reason: args.reason,
      });

  const durationSeconds = talkDurationSeconds(call.answered_at, endedAt);
  const result = callResultForStatus(status, call.answered_at);

  let activityId = call.activity_id;
  const shouldCreate =
    (args.createActivity ?? true) && !activityId && Boolean(call.agent_user_id);

  if (shouldCreate) {
    const minutes = callDurationMinutes(durationSeconds);
    const descriptionParts = [
      `Duración: ${formatCallDuration(durationSeconds)}`,
      `Resultado: ${callResultLabel(result)}`,
    ];
    const { data: activity, error: activityError } = await db
      .from('activities')
      .insert({
        account_id: call.account_id,
        user_id: call.agent_user_id,
        assigned_to: call.agent_profile_id,
        type: 'call',
        subject: callSubject({
          direction: call.direction,
          number:
            call.direction === 'inbound' ? call.from_number : call.to_number,
          contactName: args.contactName,
        }),
        description: descriptionParts.join(' · '),
        due_at: endedAt,
        duration_minutes: minutes,
        status: 'done',
        priority: 'medium',
        outcome: callResultLabel(result),
        call_direction: call.direction,
        call_result: result,
        completed_at: endedAt,
        contact_id: call.contact_id,
        lead_id: call.lead_id,
      })
      .select('id')
      .single();

    if (activityError) {
      // La llamada no se pierde si falla el CRM (p. ej. 054 sin
      // aplicar); queda el registro en call_sessions.
      console.error(
        '[telephony] no se pudo crear la actividad:',
        activityError
      );
    } else {
      activityId = activity.id as string;
    }
  }

  let query = db
    .from('call_sessions')
    .update({
      status,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      end_reason: args.reason ?? 'hangup',
      activity_id: activityId,
    })
    .eq('id', call.id);
  if (args.guard?.status) {
    query = query.eq('status', args.guard.status);
  }
  if (args.guard && 'agent_user_id' in args.guard) {
    query = args.guard.agent_user_id == null
      ? query.is('agent_user_id', null)
      : query.eq('agent_user_id', args.guard.agent_user_id);
  }

  const { error: updateError } = await query;

  if (updateError) {
    console.error('[telephony] no se pudo cerrar la llamada:', updateError);
    throw updateError;
  }

  // Devolución de llamada perdida (migración 122): entrante que nunca
  // se contestó y terminó perdida o rechazada. El índice único por
  // `source_call_id` evita duplicados si dos procesos cierran a la vez.
  const callbackPhone = call.from_number;
  const shouldCreateCallback =
    shouldCreateCallbackForCall({
      direction: call.direction,
      answeredAt: call.answered_at,
      status,
      phone: callbackPhone,
    });

  if (shouldCreateCallback && callbackPhone) {
    const { error: callbackError } = await db
      .from('callback_requests')
      .upsert(
        {
          account_id: call.account_id,
          contact_id: call.contact_id,
          phone: callbackPhone,
          source_call_id: call.id,
          reason: callbackReasonFor(args.reason),
          status: 'pending',
        },
        { onConflict: 'source_call_id', ignoreDuplicates: true }
      );
    if (
      callbackError &&
      callbackError.code !== '42P01' &&
      callbackError.code !== 'PGRST205'
    ) {
      console.warn(
        '[telephony] no se pudo crear la devolución de llamada:',
        callbackError
      );
    }
  }

  const { error: eventError } = await db.from('call_events').insert({
    account_id: call.account_id,
    call_id: call.id,
    type: 'ended',
    actor_user_id: call.agent_user_id,
    payload: {
      reason: args.reason ?? 'hangup',
      status,
      duration_seconds: durationSeconds,
      activity_id: activityId,
    },
  });
  if (eventError) {
    console.warn(
      '[telephony] no se pudo escribir el evento de cierre:',
      eventError
    );
  }

  // Si la llamada salió de una campaña saliente (124), se cierra el
  // intento en la función atómica: cuenta el intento, deja el
  // contacto como contactado o lo devuelve a la cola mientras le
  // queden intentos. Repetir el cierre no infla el contador porque la
  // función solo actúa sobre contactos en `dialing`.
  const campaignContactId =
    typeof call.metadata?.campaign_contact_id === 'string'
      ? (call.metadata.campaign_contact_id as string)
      : null;
  if (campaignContactId) {
    const outcome = call.answered_at ? 'answered' : status;
    const { error: campaignError } = await db.rpc('record_campaign_attempt', {
      p_contact_id: campaignContactId,
      p_call_id: call.id,
      p_outcome: outcome,
    });
    if (campaignError && campaignError.code !== '42883') {
      console.warn(
        '[telephony] no se pudo cerrar el intento de campaña:',
        campaignError
      );
    }
  }

  return {
    status,
    durationSeconds,
    activityId,
    alreadyClosed: false,
  };
}

/** Motivo de la devolución a partir del cierre de la llamada. */
export function callbackReasonFor(
  reason?: HangupReason
): 'missed' | 'timeout' | 'declined' {
  if (reason === 'timeout') return 'timeout';
  if (reason === 'declined') return 'declined';
  return 'missed';
}

/**
 * ¿La llamada cerrada debe generar una devolución?
 *
 * Solo entrantes que nunca se contestaron y terminaron perdidas o
 * rechazadas. Un fallo de transporte (`failed`) no se devuelve: no
 * hubo un cliente esperando.
 */
export function shouldCreateCallbackForCall(args: {
  direction: 'inbound' | 'outbound';
  answeredAt: string | null;
  status: CallSessionStatus;
  phone: string | null;
}): boolean {
  return (
    args.direction === 'inbound' &&
    !args.answeredAt &&
    (args.status === 'missed' || args.status === 'cancelled') &&
    Boolean(args.phone)
  );
}
