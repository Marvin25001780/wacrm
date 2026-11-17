import { NextResponse } from 'next/server';

import { getCurrentAccount } from '@/lib/auth/account';
import { derivePresence } from '@/lib/presence';
import {
  resolveTelephony,
  loadAgentSkills,
  loadTelephonyConfig,
  telephonyBlockReason,
} from '@/lib/telephony/config';
import { telephonyEnv } from '@/lib/telephony/env';
import { telephonyErrorResponse } from '@/lib/telephony/http';
import { sweepExpiredQueue, sweepSkillOverflow } from '@/lib/telephony/queue-sweep';
import { loadTelephonyRoster } from '@/lib/telephony/roster';
import { agentCanTakeCall } from '@/lib/telephony/skills';
import { releaseExpiredTransfers } from '@/lib/telephony/transfers';
import type { AgentStatus, CallSession, TelephonyStatus } from '@/types';

/** Cuántas entrantes se miran para elegir una que el agente pueda tomar. */
const INCOMING_CANDIDATES = 25;

/**
 * GET /api/telephony/status
 *
 * Estado que necesita el softphone: si el servidor tiene LiveKit,
 * si el negocio puede marcar, el estado del agente y la llamada
 * activa (si la hay). Además retira de la cola las entrantes que
 * excedieron la espera máxima configurada (barrido perezoso, ACD) y
 * levanta el requisito de habilidad cuando toca (desbordamiento).
 * Nunca devuelve claves.
 */
export async function GET() {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount();
    const env = telephonyEnv();

    const loaded = await loadTelephonyConfig(supabase, accountId);
    const resolved = resolveTelephony(loaded, env);
    const agentSkills = await loadAgentSkills(supabase, accountId, userId);

    // Barridos perezosos ANTES de leer la cola: primero el timeout de
    // espera (116) y después el desbordamiento por habilidad (119),
    // para ofrecer una foto ya al día.
    let queueClosed: string[] = [];
    let queueOverflowed: string[] = [];
    let transferReleased: string[] = [];
    try {
      const sweep = await sweepExpiredQueue({
        db: supabase,
        accountId,
        maxWaitSeconds: resolved.queueMaxWaitSeconds,
      });
      queueClosed = sweep.closed.map((call) => call.id);

      const overflow = await sweepSkillOverflow({
        db: supabase,
        accountId,
        overflowSeconds: resolved.skillOverflowSeconds,
      });
      queueOverflowed = overflow.overflowed.map((call) => call.id);

      // 123 — transferencias que nadie contestó vuelven a la cola.
      const released = await releaseExpiredTransfers({
        db: supabase,
        accountId,
      });
      transferReleased = released.released.map((call) => call.id);
    } catch (sweepError) {
      // El estado debe responder aunque el barrido falle.
      console.warn('[telephony] barrido de cola falló:', sweepError);
    }

    const [{ data: presenceRow }, { data: myCalls }, { data: incomingCandidates }] =
      await Promise.all([
        supabase
          .from('member_presence')
          .select('status, last_seen_at, agent_status')
          .eq('user_id', userId)
          .maybeSingle(),
        // 123 — puede haber dos: una llamada propia y una transferencia
        // pendiente para mí. Se clasifican abajo.
        supabase
          .from('call_sessions')
          .select('*, contact:contacts(id, name, phone)')
          .eq('account_id', accountId)
          .eq('agent_user_id', userId)
          .in('status', ['ringing', 'active'])
          .order('started_at', { ascending: false })
          .limit(2),
        // Cola: entrantes sin agente. Incluye las devueltas a la cola
        // por una transferencia, que siguen en `active` porque ya se
        // contestaron una vez (123).
        supabase
          .from('call_sessions')
          .select('*, contact:contacts(id, name, phone)')
          .eq('account_id', accountId)
          .eq('direction', 'inbound')
          .in('status', ['ringing', 'active'])
          .is('agent_user_id', null)
          .order('priority', { ascending: false })
          .order('started_at', { ascending: true })
          .limit(INCOMING_CANDIDATES),
      ]);

    const stored =
      (presenceRow?.status as 'online' | 'away' | undefined) ?? undefined;
    const presence = derivePresence(
      stored,
      presenceRow?.last_seen_at,
      Date.now()
    );
    const agentStatus =
      (presenceRow?.agent_status as AgentStatus | undefined) ?? 'available';

    const liveRows = (myCalls ?? []) as CallSession[];
    const incomingTransfer =
      liveRows.find(
        (call) => call.status === 'ringing' && Boolean(call.transfer_at)
      ) ?? null;
    const activeCall =
      liveRows.find(
        (call) => !(call.status === 'ringing' && call.transfer_at)
      ) ?? null;

    // La primera entrante de la cola que este agente puede tomar: sin
    // requisito, con las habilidades completas o ya desbordada.
    const queueCall =
      ((incomingCandidates ?? []) as CallSession[]).find((call) =>
        agentCanTakeCall(call, agentSkills)
      ) ?? null;

    // Una transferencia asignada a mí manda sobre la cola: ya está en
    // mi sala de LiveKit y el cliente me está esperando. Igual que la
    // cola, solo se ofrece si estoy Disponible.
    const incomingCall =
      agentStatus === 'available'
        ? (incomingTransfer ?? queueCall)
        : null;

    if (incomingTransfer?.transfer_from_user_id) {
      const roster = await loadTelephonyRoster(supabase, accountId);
      incomingTransfer.transfer_from_name =
        roster?.find(
          (member) => member.user_id === incomingTransfer.transfer_from_user_id
        )?.name ?? null;
    }

    const payload: TelephonyStatus = {
      ready: resolved.livekitReady,
      missing: env.missing,
      migrationMissing: resolved.migrationMissing,
      enabled: resolved.enabled,
      dialReady: resolved.dialReady && resolved.enabled,
      blockReason: telephonyBlockReason(resolved),
      trunkConfigured: Boolean(resolved.trunkId),
      callerId: resolved.callerId,
      recording: {
        serverEnabled: env.recordingEnabled,
        accountEnabled: Boolean(resolved.row?.recording_enabled),
        transcriptionEnabled: resolved.transcriptionEnabled,
        publicPlayback: Boolean(env.recordingsPublicBaseUrl),
      },
      config: resolved.row,
      agentStatus,
      presence: {
        online: presence === 'online',
        stored: presence,
        last_seen_at: presenceRow?.last_seen_at ?? null,
      },
      activeCall,
      // La cola solo suena para agentes disponibles: en pausa, cierre
      // u ocupado no se ofrece la entrante. Una transferencia asignada
      // a mí sí se ofrece aunque esté en pausa (ya está en mi sala).
      incomingCall,
      queueMaxWaitSeconds: resolved.queueMaxWaitSeconds,
      queueClosed,
      agentSkills,
      skillOverflowSeconds: resolved.skillOverflowSeconds,
      queueOverflowed,
      transferRingTimeoutSeconds: resolved.transferRingTimeoutSeconds,
      maxTransfersPerCall: resolved.maxTransfersPerCall,
      transferReleased,
    };

    return NextResponse.json(payload);
  } catch (err) {
    return telephonyErrorResponse(err);
  }
}
