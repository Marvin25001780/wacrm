// ============================================================
// Cambio de estado del agente (una sola puerta).
//
// La migración 120 amplió `set_agent_status` a
// (p_status, p_reason, p_source). Mientras un despliegue no la tenga
// aplicada, la función solo acepta `p_status`: aquí se reintenta sin
// los argumentos nuevos para que el softphone siga funcionando.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AgentStatus } from '@/types';

export interface SetAgentStatusOptions {
  /** Solo para `break`; queda en la bitácora (migración 120). */
  reason?: string | null;
  /** `agent` = lo eligió la persona; `system` = lo puso la app. */
  source?: 'agent' | 'system';
}

/** `true` si el error significa que la función no tiene esa firma. */
function isSignatureMismatch(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

export async function setAgentStatusRpc(
  db: SupabaseClient,
  status: AgentStatus,
  options: SetAgentStatusOptions = {}
) {
  const reason =
    status === 'break' && options.reason
      ? options.reason.trim().slice(0, 60) || null
      : null;

  const rpc = await db.rpc('set_agent_status', {
    p_status: status,
    p_reason: reason,
    p_source: options.source ?? 'agent',
  });

  if (rpc.error && isSignatureMismatch(rpc.error)) {
    return db.rpc('set_agent_status', { p_status: status });
  }

  return rpc;
}
