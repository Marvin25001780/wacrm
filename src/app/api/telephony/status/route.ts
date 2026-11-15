import { NextResponse } from 'next/server';

import { getCurrentAccount } from '@/lib/auth/account';
import { derivePresence } from '@/lib/presence';
import {
  resolveTelephony,
  loadTelephonyConfig,
  telephonyBlockReason,
} from '@/lib/telephony/config';
import { telephonyEnv } from '@/lib/telephony/env';
import { telephonyErrorResponse } from '@/lib/telephony/http';
import type { AgentStatus, CallSession, TelephonyStatus } from '@/types';

/**
 * GET /api/telephony/status
 *
 * Estado que necesita el softphone: si el servidor tiene LiveKit,
 * si el negocio puede marcar, el estado del agente y la llamada
 * activa (si la hay). Nunca devuelve claves.
 */
export async function GET() {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount();
    const env = telephonyEnv();

    const loaded = await loadTelephonyConfig(supabase, accountId);
    const resolved = resolveTelephony(loaded, env);

    const [
      { data: presenceRow },
      { data: activeCall },
      { data: incomingCall },
    ] = await Promise.all([
      supabase
        .from('member_presence')
        .select('status, last_seen_at, agent_status')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('call_sessions')
        .select('*, contact:contacts(id, name, phone)')
        .eq('account_id', accountId)
        .eq('agent_user_id', userId)
        .in('status', ['ringing', 'active'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('call_sessions')
        .select('*, contact:contacts(id, name, phone)')
        .eq('account_id', accountId)
        .eq('direction', 'inbound')
        .eq('status', 'ringing')
        .is('agent_user_id', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const stored =
      (presenceRow?.status as 'online' | 'away' | undefined) ?? undefined;
    const presence = derivePresence(
      stored,
      presenceRow?.last_seen_at,
      Date.now()
    );

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
      agentStatus:
        (presenceRow?.agent_status as AgentStatus | undefined) ?? 'available',
      presence: {
        online: presence === 'online',
        stored: presence,
        last_seen_at: presenceRow?.last_seen_at ?? null,
      },
      activeCall: (activeCall as CallSession | null) ?? null,
      incomingCall: (incomingCall as CallSession | null) ?? null,
    };

    return NextResponse.json(payload);
  } catch (err) {
    return telephonyErrorResponse(err);
  }
}
