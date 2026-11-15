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

  const { error: updateError } = await db
    .from('call_sessions')
    .update({
      status,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      end_reason: args.reason ?? 'hangup',
      activity_id: activityId,
    })
    .eq('id', call.id);

  if (updateError) {
    console.error('[telephony] no se pudo cerrar la llamada:', updateError);
    throw updateError;
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

  return {
    status,
    durationSeconds,
    activityId,
    alreadyClosed: false,
  };
}
