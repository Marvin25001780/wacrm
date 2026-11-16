import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { derivePresence } from '@/lib/presence';
import { loadTelephonyConfig, resolveTelephony } from '@/lib/telephony/config';
import { loadTelephonyRoster } from '@/lib/telephony/roster';
import { normalizeSkillList } from '@/lib/telephony/skills';
import { sweepExpiredQueue, sweepSkillOverflow } from '@/lib/telephony/queue-sweep';
import type {
  AgentStatus,
  CallDirection,
  CallSessionStatus,
  TelephonyAgentSupervision,
  TelephonyQueueItem,
  TelephonySupervision,
} from '@/types';

const AGENT_STATUSES = new Set<AgentStatus>([
  'available',
  'busy',
  'wrap_up',
  'break',
]);

interface LiveCallRow {
  id: string;
  direction: CallDirection;
  status: CallSessionStatus;
  from_number: string | null;
  to_number: string | null;
  started_at: string;
  answered_at: string | null;
  agent_user_id: string | null;
  required_skills?: string[] | null;
  overflowed_at?: string | null;
  contact: { name: string | null } | null;
}

/**
 * GET /api/telephony/agents — panel de supervisión (admin+).
 *
 * Devuelve, por cada miembro del negocio, su presencia (derivada del
 * heartbeat), su estado operativo y la llamada que tiene en curso;
 * más la cola de entrantes sin reclamar. Es solo lectura: contestar
 * sigue siendo el claim atómico de cada agente.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const now = Date.now();

    // Barrido perezoso de la cola antes de listar: las entrantes que
    // excedieron la espera máxima salen de la cola (timeout de ACD).
    const loadedConfig = await loadTelephonyConfig(ctx.supabase, ctx.accountId);
    const resolvedConfig = resolveTelephony(loadedConfig);
    if (!loadedConfig.migrationMissing) {
      try {
        await sweepExpiredQueue({
          db: ctx.supabase,
          accountId: ctx.accountId,
          maxWaitSeconds: resolvedConfig.queueMaxWaitSeconds,
        });
        await sweepSkillOverflow({
          db: ctx.supabase,
          accountId: ctx.accountId,
          overflowSeconds: resolvedConfig.skillOverflowSeconds,
        });
      } catch (sweepError) {
        console.warn('[telephony] barrido de cola falló:', sweepError);
      }
    }

    const presenceResult = await loadPresence(ctx.supabase, ctx.accountId);
    const live = await loadLiveCalls(ctx.supabase, ctx.accountId);

    const callsMissing = live.missing;
    const calls: LiveCallRow[] = live.rows;

    const roster = await loadTelephonyRoster(ctx.supabase, ctx.accountId);
    if (!roster) {
      return NextResponse.json(
        { error: 'No se pudo cargar el equipo del negocio.' },
        { status: 500 }
      );
    }

    const presenceByUser = new Map(
      (presenceResult ?? []).map((row) => [row.user_id, row])
    );
    const callByUser = new Map<string, LiveCallRow>();
    const queue: TelephonyQueueItem[] = [];

    for (const call of calls) {
      if (!call.agent_user_id) {
        if (call.direction === 'inbound') {
          queue.push({
            id: call.id,
            from_number: call.from_number,
            to_number: call.to_number,
            started_at: call.started_at,
            contact_name: call.contact?.name ?? null,
            required_skills: normalizeSkillList(call.required_skills).skills,
            overflowed_at: call.overflowed_at ?? null,
          });
        }
        continue;
      }
      if (!callByUser.has(call.agent_user_id)) {
        callByUser.set(call.agent_user_id, call);
      }
    }

    const agents: TelephonyAgentSupervision[] = roster.map((member) => {
      const presence = presenceByUser.get(member.user_id);
      const stored = presence?.status;
      const call = callByUser.get(member.user_id) ?? null;
      const rawStatus = presence?.agent_status;
      return {
        user_id: member.user_id,
        name: member.name,
        role: member.role,
        presence: derivePresence(stored, presence?.last_seen_at, now),
        agent_status:
          rawStatus && AGENT_STATUSES.has(rawStatus) ? rawStatus : 'available',
        last_seen_at: presence?.last_seen_at ?? null,
        skills: member.skills,
        active_call: call
          ? {
              id: call.id,
              direction: call.direction,
              number:
                call.direction === 'inbound'
                  ? call.from_number
                  : call.to_number,
              status: call.status,
              started_at: call.started_at,
              answered_at: call.answered_at,
            }
          : null,
      };
    });

    const payload: TelephonySupervision = {
      agents,
      queue,
      updated_at: new Date(now).toISOString(),
      migrationMissing: callsMissing,
    };
    return NextResponse.json(payload);
  } catch (err) {
    return toErrorResponse(err);
  }
}

interface PresenceRowLite {
  user_id: string;
  status: 'online' | 'away';
  last_seen_at: string;
  agent_status: AgentStatus;
}

/**
 * Llamadas sonando o en curso. Si la 119 no está aplicada, las
 * columnas de habilidad no existen (42703) y se leen sin ellas: la
 * cola funciona como antes del desbordamiento.
 */
async function loadLiveCalls(
  db: SupabaseClient,
  accountId: string
): Promise<{ rows: LiveCallRow[]; missing: boolean }> {
  const base =
    'id, direction, status, from_number, to_number, started_at, answered_at, agent_user_id, contact:contacts(name)';

  const withSkills = await db
    .from('call_sessions')
    .select(`${base}, required_skills, overflowed_at`)
    .eq('account_id', accountId)
    .in('status', ['ringing', 'active'])
    .order('priority', { ascending: false })
    .order('started_at', { ascending: true })
    .limit(100);

  if (!withSkills.error) {
    return {
      rows: (withSkills.data ?? []) as unknown as LiveCallRow[],
      missing: false,
    };
  }

  if (withSkills.error.code !== '42703') {
    return { rows: [], missing: isMissingRelation(withSkills.error) };
  }

  const legacy = await db
    .from('call_sessions')
    .select(base)
    .eq('account_id', accountId)
    .in('status', ['ringing', 'active'])
    .order('priority', { ascending: false })
    .order('started_at', { ascending: true })
    .limit(100);

  return {
    rows: (legacy.data ?? []) as unknown as LiveCallRow[],
    missing: isMissingRelation(legacy.error),
  };
}

/**
 * Lee la presencia del negocio. Si la 112 no está aplicada la columna
 * `agent_status` no existe (42703); en ese caso se lee sin ella y el
 * panel muestra "disponible" para todos.
 */
async function loadPresence(
  db: SupabaseClient,
  accountId: string
): Promise<PresenceRowLite[]> {
  const withStatus = await db
    .from('member_presence')
    .select('user_id, status, last_seen_at, agent_status')
    .eq('account_id', accountId);

  if (!withStatus.error) {
    return (withStatus.data ?? []) as PresenceRowLite[];
  }
  if (withStatus.error.code !== '42703') {
    throw withStatus.error;
  }

  const legacy = await db
    .from('member_presence')
    .select('user_id, status, last_seen_at')
    .eq('account_id', accountId);
  if (legacy.error) throw legacy.error;
  return ((legacy.data ?? []) as Omit<PresenceRowLite, 'agent_status'>[]).map(
    (row) => ({ ...row, agent_status: 'available' as AgentStatus })
  );
}

/** Tabla de llamadas ausente = migración 112 sin aplicar. */
function isMissingRelation(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}
