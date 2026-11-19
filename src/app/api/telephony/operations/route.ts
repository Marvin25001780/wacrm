import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { derivePresence } from '@/lib/presence';
import { loadTelephonyConfig, resolveTelephony } from '@/lib/telephony/config';
import {
  LONG_BREAK_SECONDS,
  LONG_WRAP_UP_SECONDS,
  SLA_AT_RISK_RATIO,
  queueSlaState,
  queueWaitRealSeconds,
} from '@/lib/telephony/operations';
import { sweepExpiredQueue, sweepSkillOverflow } from '@/lib/telephony/queue-sweep';
import {
  loadMemberPresence,
  loadTelephonyRoster,
} from '@/lib/telephony/roster';
import { normalizeSkillList } from '@/lib/telephony/skills';
import { releaseExpiredTransfers } from '@/lib/telephony/transfers';
import type {
  AgentStatus,
  CallDirection,
  CallSessionStatus,
  TelephonyOperations,
  TelephonyOperationsAgent,
  TelephonyOperationsQueueItem,
  TelephonyPendingTransfer,
} from '@/types';

const AGENT_STATUSES = new Set<AgentStatus>([
  'available',
  'busy',
  'wrap_up',
  'break',
]);

/** Orden del panel: primero quien puede atender, al final quien no está. */
const STATUS_ORDER: Record<AgentStatus, number> = {
  available: 0,
  busy: 1,
  wrap_up: 2,
  break: 3,
};

/** Días de bitácora que se leen para saber desde cuándo está en su estado. */
const STATUS_LOOKBACK_DAYS = 7;
/** Tope de filas de bitácora (cambios de estado, no llamadas). */
const STATUS_LOG_LIMIT = 5_000;
const LIVE_CALL_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

interface LiveCallRow {
  id: string;
  direction: CallDirection;
  status: CallSessionStatus;
  from_number: string | null;
  to_number: string | null;
  started_at: string;
  answered_at: string | null;
  agent_user_id: string | null;
  transfer_from_user_id?: string | null;
  transfer_at?: string | null;
  transfer_timeout_seconds?: number | null;
  transfer_count?: number | null;
  required_skills?: string[] | null;
  overflowed_at?: string | null;
  queued_at?: string | null;
  priority?: number | null;
  contact: { name: string | null } | null;
}

interface StatusLogRow {
  user_id: string;
  status: AgentStatus;
  changed_at: string;
  reason: string | null;
}

/**
 * GET /api/telephony/operations — panel de operación en vivo (admin+).
 *
 * Devuelve la cola con la espera real y su estado de SLA, los agentes
 * con el tiempo que llevan en su estado actual, y las transferencias
 * que todavía nadie aceptó. Es solo lectura: el panel no contesta ni
 * despacha llamadas, solo las muestra.
 *
 * Antes de leer hace el barrido perezoso (timeout de cola,
 * desbordamiento por habilidad y transferencias vencidas), así los
 * números del panel coinciden con lo que ve el softphone.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const now = Date.now();

    const loaded = await loadTelephonyConfig(ctx.supabase, ctx.accountId);
    const resolved = resolveTelephony(loaded);
    if (!loaded.migrationMissing) {
      try {
        await sweepExpiredQueue({
          db: ctx.supabase,
          accountId: ctx.accountId,
          maxWaitSeconds: resolved.queueMaxWaitSeconds,
        });
        await sweepSkillOverflow({
          db: ctx.supabase,
          accountId: ctx.accountId,
          overflowSeconds: resolved.skillOverflowSeconds,
        });
        await releaseExpiredTransfers({
          db: ctx.supabase,
          accountId: ctx.accountId,
        });
      } catch (sweepError) {
        console.warn('[telephony] barrido del panel falló:', sweepError);
      }
    }

    const [roster, presence, live, statusLog] = await Promise.all([
      loadTelephonyRoster(ctx.supabase, ctx.accountId),
      loadMemberPresence(ctx.supabase, ctx.accountId),
      loadLiveCalls(ctx.supabase, ctx.accountId),
      loadLatestStatuses(ctx.supabase, ctx.accountId, now),
    ]);

    if (!roster) {
      return NextResponse.json(
        { error: 'No se pudo cargar el equipo del negocio.' },
        { status: 500 }
      );
    }

    const nameByUser = new Map(roster.map((member) => [member.user_id, member.name]));
    const presenceByUser = new Map(presence.map((row) => [row.user_id, row]));

    const queue: TelephonyOperationsQueueItem[] = [];
    const transfers: TelephonyPendingTransfer[] = [];
    const callByUser = new Map<string, LiveCallRow>();

    for (const call of live.rows) {
      if (call.status === 'ringing' && call.transfer_at) {
        // Transferencia esperando respuesta: tiene dueño, pero todavía
        // no la atiende. No va a la cola ni cuenta como llamada activa.
        const toUserId = call.agent_user_id;
        if (toUserId) {
          transfers.push({
            call_id: call.id,
            from_user_id: call.transfer_from_user_id ?? null,
            from_name: call.transfer_from_user_id
              ? (nameByUser.get(call.transfer_from_user_id) ?? null)
              : null,
            to_user_id: toUserId,
            to_name: nameByUser.get(toUserId) ?? 'Agente',
            number:
              call.direction === 'inbound' ? call.from_number : call.to_number,
            contact_name: call.contact?.name ?? null,
            transfer_at: call.transfer_at,
            timeout_seconds:
              call.transfer_timeout_seconds ?? resolved.transferRingTimeoutSeconds,
            transfer_count: call.transfer_count ?? 0,
          });
        }
        continue;
      }

      if (!call.agent_user_id) {
        if (call.direction === 'inbound') {
          const waitSeconds = queueWaitRealSeconds({
            startedAt: call.started_at,
            queuedAt: call.queued_at ?? null,
            now,
          });
          queue.push({
            id: call.id,
            from_number: call.from_number,
            to_number: call.to_number,
            started_at: call.started_at,
            queued_at: call.queued_at ?? null,
            contact_name: call.contact?.name ?? null,
            required_skills: normalizeSkillList(call.required_skills).skills,
            overflowed_at: call.overflowed_at ?? null,
            priority: call.priority ?? 0,
            wait_seconds: waitSeconds,
            sla: queueSlaState({
              waitSeconds,
              maxWaitSeconds: resolved.queueMaxWaitSeconds,
            }),
          });
        }
        continue;
      }

      if (!callByUser.has(call.agent_user_id)) {
        callByUser.set(call.agent_user_id, call);
      }
    }

    queue.sort(
      (a, b) => b.priority - a.priority || b.wait_seconds - a.wait_seconds
    );
    transfers.sort(
      (a, b) => Date.parse(a.transfer_at) - Date.parse(b.transfer_at)
    );

    const transferByUser = new Set(transfers.map((row) => row.to_user_id));
    const statusByUser = statusLog.byUser;

    const agents: TelephonyOperationsAgent[] = roster.map((member) => {
      const row = presenceByUser.get(member.user_id);
      const rawStatus = row?.agent_status;
      const agentStatus =
        rawStatus && AGENT_STATUSES.has(rawStatus) ? rawStatus : 'available';
      const call = callByUser.get(member.user_id) ?? null;
      const logged = statusByUser.get(member.user_id);

      return {
        user_id: member.user_id,
        name: member.name,
        role: member.role,
        presence: derivePresence(row?.status, row?.last_seen_at, now),
        agent_status: agentStatus,
        last_seen_at: row?.last_seen_at ?? null,
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
        // Solo se usa el cambio de la bitácora si corresponde al estado
        // actual; si no, el tiempo real se desconoce (null, sin inventar).
        status_changed_at:
          logged && logged.status === agentStatus ? logged.changed_at : null,
        status_reason: logged?.reason ?? null,
        transfer_pending: transferByUser.has(member.user_id),
      };
    });

    agents.sort((a, b) => {
      const offlineA = a.presence === 'offline' ? 1 : 0;
      const offlineB = b.presence === 'offline' ? 1 : 0;
      if (offlineA !== offlineB) return offlineA - offlineB;
      const statusDiff =
        STATUS_ORDER[a.agent_status] - STATUS_ORDER[b.agent_status];
      if (statusDiff !== 0) return statusDiff;
      return a.name.localeCompare(b.name);
    });

    const payload: TelephonyOperations = {
      agents,
      queue,
      transfers,
      queueMaxWaitSeconds: resolved.queueMaxWaitSeconds,
      slaAtRiskRatio: SLA_AT_RISK_RATIO,
      longBreakSeconds: LONG_BREAK_SECONDS,
      longWrapUpSeconds: LONG_WRAP_UP_SECONDS,
      statusLogMissing: statusLog.missing,
      updated_at: new Date(now).toISOString(),
      migrationMissing: live.missing,
    };
    return NextResponse.json(payload);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Llamadas sonando o en curso. Se leen todas las columnas para no
 * romperse cuando una migración nueva añade campos: el payload se
 * construye explícitamente y no se filtra nada al cliente.
 */
async function loadLiveCalls(
  db: SupabaseClient,
  accountId: string
): Promise<{ rows: LiveCallRow[]; missing: boolean }> {
  const result = await db
    .from('call_sessions')
    .select('*, contact:contacts(name)')
    .eq('account_id', accountId)
    .in('status', ['ringing', 'active'])
    .order('priority', { ascending: false })
    .order('started_at', { ascending: true })
    .limit(LIVE_CALL_LIMIT);

  return {
    rows: (result.data ?? []) as unknown as LiveCallRow[],
    missing: isMissingRelation(result.error),
  };
}

/**
 * Último cambio de estado por agente. Se lee hacia atrás y se queda
 * con la primera fila de cada uno. Si el último cambio es anterior a
 * la ventana, el tiempo en estado queda desconocido (`null`) en vez
 * de mostrar una cifra falsa.
 */
async function loadLatestStatuses(
  db: SupabaseClient,
  accountId: string,
  now: number
): Promise<{
  byUser: Map<string, { status: AgentStatus; changed_at: string; reason: string | null }>;
  missing: boolean;
}> {
  const since = new Date(now - STATUS_LOOKBACK_DAYS * DAY_MS).toISOString();
  const result = await db
    .from('agent_status_log')
    .select('user_id, status, changed_at, reason')
    .eq('account_id', accountId)
    .gte('changed_at', since)
    .order('changed_at', { ascending: false })
    .limit(STATUS_LOG_LIMIT);

  if (result.error) {
    if (!isMissingRelation(result.error)) throw result.error;
    return { byUser: new Map(), missing: true };
  }

  const byUser = new Map<
    string,
    { status: AgentStatus; changed_at: string; reason: string | null }
  >();
  for (const row of (result.data ?? []) as StatusLogRow[]) {
    if (byUser.has(row.user_id)) continue;
    if (!AGENT_STATUSES.has(row.status)) continue;
    byUser.set(row.user_id, {
      status: row.status,
      changed_at: row.changed_at,
      reason: row.reason,
    });
  }
  return { byUser, missing: false };
}

function isMissingRelation(error: { code?: string } | null): boolean {
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    error?.code === '42703'
  );
}
