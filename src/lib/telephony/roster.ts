// ============================================================
// Roster del negocio para las vistas de telefonía.
//
// Comparte el criterio de /api/account/members: nombres por negocio
// (110) vía `account_member_roster`, con respaldo a `profiles` cuando
// la RPC todavía no existe. Lo usan la supervisión y los reportes.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { isAccountRole } from '@/lib/auth/roles';
import type { AccountRole } from '@/lib/auth/roles';
import type { AgentStatus } from '@/types';
import { normalizeSkillList } from './skills';

export interface TelephonyRosterMember {
  user_id: string;
  name: string;
  role: AccountRole;
  /** 119 — habilidades en este negocio (vacío si la 119 no está aplicada). */
  skills: string[];
}

export interface TelephonyPresenceRow {
  user_id: string;
  status: 'online' | 'away';
  last_seen_at: string;
  agent_status: AgentStatus;
}

/**
 * Devuelve `null` solo cuando no se pudo leer el equipo (error real);
 * `[]` significa que el negocio no tiene miembros visibles.
 */
export async function loadTelephonyRoster(
  db: SupabaseClient,
  accountId: string
): Promise<TelephonyRosterMember[] | null> {
  const rpc = await db.rpc('account_member_roster');

  if (!rpc.error) {
    const rows = (rpc.data ?? []) as {
      user_id: string;
      full_name: string | null;
      display_name?: string | null;
      email: string | null;
      role: string;
      agent_skills?: unknown;
    }[];
    return rows.flatMap((row) => {
      if (!isAccountRole(row.role)) return [];
      return [
        {
          user_id: row.user_id,
          name:
            row.display_name?.trim() ||
            row.full_name?.trim() ||
            row.email ||
            'Sin nombre',
          role: row.role,
          skills: normalizeSkillList(row.agent_skills).skills,
        },
      ];
    });
  }

  const rpcMissing = rpc.error.code === 'PGRST202' || rpc.error.code === '42883';
  if (!rpcMissing) {
    console.error('[telephony/roster] roster error:', rpc.error);
    return null;
  }

  const legacy = await db
    .from('profiles')
    .select('user_id, full_name, email, account_role')
    .eq('account_id', accountId);
  if (legacy.error) {
    console.error('[telephony/roster] legacy roster error:', legacy.error);
    return null;
  }

  return (legacy.data ?? []).flatMap((row) => {
    if (!isAccountRole(row.account_role)) return [];
    return [
      {
        user_id: row.user_id as string,
        name:
          (row.full_name as string | null)?.trim() ||
          (row.email as string | null) ||
          'Sin nombre',
        role: row.account_role,
        skills: [],
      },
    ];
  });
}

/**
 * Presencia del negocio. Si la 112 no está aplicada, `agent_status`
 * no existe (42703) y se asume `available` para todos, igual que
 * antes del contact center.
 */
export async function loadMemberPresence(
  db: SupabaseClient,
  accountId: string
): Promise<TelephonyPresenceRow[]> {
  const withStatus = await db
    .from('member_presence')
    .select('user_id, status, last_seen_at, agent_status')
    .eq('account_id', accountId);

  if (!withStatus.error) {
    return (withStatus.data ?? []) as TelephonyPresenceRow[];
  }
  if (withStatus.error.code !== '42703') throw withStatus.error;

  const legacy = await db
    .from('member_presence')
    .select('user_id, status, last_seen_at')
    .eq('account_id', accountId);
  if (legacy.error) throw legacy.error;

  return ((legacy.data ?? []) as Omit<TelephonyPresenceRow, 'agent_status'>[]).map(
    (row) => ({ ...row, agent_status: 'available' as AgentStatus })
  );
}
