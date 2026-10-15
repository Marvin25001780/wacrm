// ============================================================
// Resolución de asignación de conversaciones.
//
// Dado el catálogo `assignment_rules` de una cuenta (migración 055),
// decide a qué agente (auth.users.id) asignar una conversación. Lo usan
// el motor de automatizaciones y el motor de flujos.
//
// Reglas de emparejamiento:
//   - Una regla sin `channel` aplica a cualquier canal.
//   - Una regla con `channel` solo aplica si el canal de la
//     conversación es exactamente ese. Si el canal es desconocido
//     (p. ej. la automatización no lo trae), las reglas específicas
//     NO aplican — mejor no asignar que asignar a la persona
//     equivocada.
//   - Se evalúan por prioridad descendente; gana la primera que
//     coincide.
//
// `resolveAssignmentAgent` devuelve `null` cuando ninguna regla
// aplica: la decisión de reserva (p. ej. el primer agente) es del
// llamador, para no cambiar el comportamiento existente.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LoadedCandidate {
  id: string; // auth user id
  load: number; // conversaciones abiertas asignadas
}

export interface AssignmentRuleRow {
  id: string;
  channel: string | null;
  team_id: string | null;
  group_id: string | null;
  strategy: 'round_robin' | 'least_busy' | 'specific_user';
  target_profile_id: string | null;
  priority: number;
}

/** Elige la primera regla que aplica al canal dado (pura, testeable). */
export function pickRule(
  rules: AssignmentRuleRow[],
  channel: string | null,
): AssignmentRuleRow | null {
  return rules.find((r) => !r.channel || r.channel === channel) ?? null;
}

/** Menos cargado gana; empate se resuelve por id ascendente (estable). */
export function chooseLeastLoaded(candidates: LoadedCandidate[]): string | null {
  let best: LoadedCandidate | null = null;
  for (const c of candidates) {
    if (!best || c.load < best.load || (c.load === best.load && c.id < best.id)) {
      best = c;
    }
  }
  return best?.id ?? null;
}

/**
 * Resuelve el agente según las reglas activas de la cuenta.
 * Devuelve `null` si no hay reglas, ninguna aplica, o la regla no
 * tiene candidatos — el llamador decide el respaldo.
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

    const rule = pickRule((ruleData ?? []) as AssignmentRuleRow[], channel);
    if (!rule) return null;

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

    if (profileIds.length === 0) return null;

    const { data: profiles } = await db
      .from('profiles')
      .select('id, user_id')
      .in('id', profileIds);
    const userIds = ((profiles ?? []) as { user_id: string | null }[])
      .map((p) => p.user_id)
      .filter((v): v is string => Boolean(v));

    if (userIds.length === 0) return null;
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

/** Respaldo heredado: primer agente de la cuenta (auth user id). */
export async function firstAccountAgent(
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
