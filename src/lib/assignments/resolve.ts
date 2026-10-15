// ============================================================
// Resolución de asignación de conversaciones.
//
// Dado el catálogo `assignment_rules` de una cuenta (migración 055),
// decide a qué agente (auth.users.id) asignar una conversación. Lo usa
// el motor de automatizaciones en el paso «Asignar conversación» cuando
// el modo es round-robin.
//
// La parte de decisión (`chooseLeastLoaded`) es pura y testeable; la
// parte de E/S (`resolveAssignmentAgent`) consulta las reglas y el
// equipo/grupo destino. Cualquier fallo devuelve `null` y el motor
// conserva su comportamiento anterior.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LoadedCandidate {
  /** auth.users.id del candidato. */
  id: string;
  /** Conversaciones abiertas asignadas actualmente. */
  load: number;
}

/**
 * Elige el candidato con menos carga; empate → id lexicográficamente
 * menor (estable). Devuelve null si no hay candidatos.
 */
export function chooseLeastLoaded(candidates: LoadedCandidate[]): string | null {
  let best: LoadedCandidate | null = null;
  for (const c of candidates) {
    if (
      best === null ||
      c.load < best.load ||
      (c.load === best.load && c.id < best.id)
    ) {
      best = c;
    }
  }
  return best?.id ?? null;
}

interface RuleRow {
  id: string;
  channel: string | null;
  team_id: string | null;
  group_id: string | null;
  strategy: 'round_robin' | 'least_busy' | 'specific_user';
  target_profile_id: string | null;
  priority: number;
}

/**
 * Devuelve el `profiles.user_id` (auth.users.id) elegido para la
 * conversación, o `null` para que el llamador use su respaldo.
 */
export async function resolveAssignmentAgent(
  db: SupabaseClient,
  params: { accountId: string; channel?: string | null },
): Promise<string | null> {
  const { accountId, channel = null } = params;
  try {
    const { data: ruleData } = await db
      .from('assignment_rules')
      .select(
        'id, channel, team_id, group_id, strategy, target_profile_id, priority',
      )
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    const rules = (ruleData ?? []) as RuleRow[];
    // Primera regla activa que coincide por canal (sin canal = cualquiera).
    const rule =
      rules.find((r) => !r.channel || !channel || r.channel === channel) ?? null;

    if (!rule) return firstAgent(db, accountId);

    if (rule.strategy === 'specific_user' && rule.target_profile_id) {
      const { data } = await db
        .from('profiles')
        .select('user_id')
        .eq('id', rule.target_profile_id)
        .maybeSingle();
      return (data as { user_id: string | null } | null)?.user_id ?? null;
    }

    let profileIds: string[] = [];
    if (rule.group_id) {
      const { data } = await db
        .from('user_group_members')
        .select('profile_id')
        .eq('group_id', rule.group_id);
      profileIds = ((data ?? []) as { profile_id: string }[]).map(
        (r) => r.profile_id,
      );
    } else if (rule.team_id) {
      const { data } = await db
        .from('team_members')
        .select('profile_id')
        .eq('team_id', rule.team_id);
      profileIds = ((data ?? []) as { profile_id: string }[]).map(
        (r) => r.profile_id,
      );
    } else {
      const { data } = await db
        .from('profiles')
        .select('id')
        .eq('account_id', accountId);
      profileIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
    }

    if (profileIds.length === 0) return firstAgent(db, accountId);

    const { data: profiles } = await db
      .from('profiles')
      .select('id, user_id')
      .in('id', profileIds);
    const userIds = ((profiles ?? []) as { user_id: string | null }[])
      .map((p) => p.user_id)
      .filter((v): v is string => Boolean(v));

    if (userIds.length === 0) return firstAgent(db, accountId);
    if (userIds.length === 1) return userIds[0];

    const load = new Map<string, number>();
    for (const u of userIds) load.set(u, 0);

    const { data: convs } = await db
      .from('conversations')
      .select('assigned_agent_id')
      .eq('account_id', accountId)
      .in('assigned_agent_id', userIds)
      .neq('status', 'closed');
    for (const c of (convs ?? []) as { assigned_agent_id: string | null }[]) {
      if (c.assigned_agent_id) {
        load.set(c.assigned_agent_id, (load.get(c.assigned_agent_id) ?? 0) + 1);
      }
    }

    return chooseLeastLoaded(
      userIds.map((u) => ({ id: u, load: load.get(u) ?? 0 })),
    );
  } catch (err) {
    console.error('[assignments] resolveAssignmentAgent failed:', err);
    return null;
  }
}

/** Comportamiento de reserva: primer agente de la cuenta. */
async function firstAgent(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .limit(1);
  const row = ((data ?? []) as { user_id: string | null }[])[0];
  return row?.user_id ?? null;
}
