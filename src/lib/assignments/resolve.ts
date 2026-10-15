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
//   - La estrategia de esa regla decide el turno entre sus
//     candidatos: `round_robin` rota (A → B → C → A …) usando el
//     cursor de la propia regla, `least_busy` elige al que tiene
//     menos conversaciones abiertas y `specific_user` no elige.
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
 * Siguiente turno del ciclo round-robin: el candidato que va justo
 * después de `last` en la lista, dada vuelta al final si hace falta.
 *
 * `userIds` llega ordenado de forma estable (id ascendente) para que
 * el ciclo sea idéntico en todos los llamadores — PostgREST no
 * promete orden en `IN (…)`. Si `last` no está en la lista (agente
 * que se fue, o cursor a `null`) se empieza por el primero.
 */
export function chooseRoundRobin(
  userIds: string[],
  last: string | null,
): string | null {
  if (userIds.length === 0) return null;
  const idx = last ? userIds.indexOf(last) : -1;
  if (idx === -1) return userIds[0];
  return userIds[(idx + 1) % userIds.length];
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

    // Orden estable: tanto el ciclo round-robin como los empates de
    // least_busy deben dar el mismo resultado en todos los llamadores
    // (PostgREST no promete orden en `IN (…)`).
    userIds.sort();
    if (userIds.length === 1) return userIds[0];

    if (rule.strategy === 'round_robin') {
      try {
        return await claimRoundRobin(db, rule.id, userIds);
      } catch (err) {
        // Migración 056 sin aplicar u otro error de escritura: en vez
        // de dejar la conversación sin asignar, degradar al reparto de
        // antes (menos ocupado) y avisar en log.
        console.error(
          '[assignments] round-robin failed, falling back to least-busy:',
          err,
        );
      }
    }

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

/**
 * Reclama el siguiente turno del ciclo para `ruleId` y devuelve al
 * elegido.
 *
 * El cursor de la regla (`last_assigned_user_id`, migración 056) se
 * lee aparte de la lista de reglas: así un entorno sin esa columna
 * solo pierde la rotación —`resolveAssignmentAgent` degrada a
 * `least_busy`— en vez de dejar de resolver todas las reglas.
 *
 * El cursor avanza con un UPDATE condicional (un WHERE sobre el valor
 * que acabamos de leer): si otra petición lo cambió a la vez no se
 * actualiza ninguna fila, releemos y reintentamos, de modo que dos
 * handoffs simultáneos nunca se reparten el mismo turno.
 *
 * Lanza si Supabase devuelve error. Si agotados los reintentos la
 * escritura sigue sin cuajar (p. ej. RLS de un cliente sin permisos)
 * se devuelve el turno calculado igualmente: asignar a veces en mal
 * orden importa menos que no asignar.
 */
async function claimRoundRobin(
  db: SupabaseClient,
  ruleId: string,
  userIds: string[],
): Promise<string | null> {
  const cursorOf = (row: { last_assigned_user_id?: string | null } | null) =>
    row?.last_assigned_user_id ?? null;

  const { data: ruleRow, error: cursorError } = await db
    .from('assignment_rules')
    .select('last_assigned_user_id')
    .eq('id', ruleId)
    .maybeSingle();
  if (cursorError) throw cursorError;

  let cursor = cursorOf(ruleRow as { last_assigned_user_id?: string | null });

  for (let attempt = 0; attempt < 4; attempt++) {
    const next = chooseRoundRobin(userIds, cursor);

    const claim = db
      .from('assignment_rules')
      .update({ last_assigned_user_id: next })
      .eq('id', ruleId);
    const guarded =
      cursor === null
        ? claim.is('last_assigned_user_id', null)
        : claim.eq('last_assigned_user_id', cursor);

    const { data: claimed, error } = await guarded.select('id');
    if (error) throw error;
    if (claimed && claimed.length > 0) return next;

    // Otro proceso se llevó el turno: releer el cursor y reintentar.
    const { data: fresh, error: readError } = await db
      .from('assignment_rules')
      .select('last_assigned_user_id')
      .eq('id', ruleId)
      .maybeSingle();
    if (readError) throw readError;
    if (!fresh) return next; // la regla desapareció entre medias
    cursor = cursorOf(fresh as { last_assigned_user_id?: string | null });
  }

  return chooseRoundRobin(userIds, cursor);
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
