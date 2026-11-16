// ============================================================
// Configuración de telefonía por negocio (migration 112).
//
// La fila es opcional: sin fila se usan los valores del despliegue
// (troncal y número saliente por entorno). Una fila permite apagar
// la telefonía para un negocio, usar otra troncal o grabar.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { TelephonyConfig } from '@/types';
import { normalizePhone } from './phone';
import { normalizeSkillList, normalizeSkillOverflowSeconds } from './skills';
import {
  canDialPstn,
  isLivekitReady,
  telephonyEnv,
  type TelephonyEnv,
} from './env';

export interface LoadedTelephonyConfig {
  row: TelephonyConfig | null;
  /** La tabla no existe todavía (migración 112 sin aplicar). */
  migrationMissing: boolean;
}

export async function loadTelephonyConfig(
  db: SupabaseClient,
  accountId: string
): Promise<LoadedTelephonyConfig> {
  const { data, error } = await db
    .from('telephony_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    // 42P01 = undefined_table; PostgREST también devuelve PGRST205
    // cuando el esquema aún no conoce la tabla.
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { row: null, migrationMissing: true };
    }
    throw error;
  }

  return {
    row: (data as TelephonyConfig | null) ?? null,
    migrationMissing: false,
  };
}

export interface ResolvedTelephony {
  row: TelephonyConfig | null;
  migrationMissing: boolean;
  /** Interruptor del negocio (sin fila = activo). */
  enabled: boolean;
  /** Troncal efectiva: la del negocio o la del entorno. */
  trunkId: string | null;
  callerId: string | null;
  inboundNumbers: string[];
  /** Grabación pedida por el negocio Y habilitada en el servidor. */
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  /** 116 — máximo de espera en cola del negocio (0 = sin límite). */
  queueMaxWaitSeconds: number;
  /** 119 — habilidades que exige la cola entrante (vacío = ninguna). */
  requiredSkills: string[];
  /** 119 — segundos antes de levantar el requisito (0 = sin desbordamiento). */
  skillOverflowSeconds: number;
  env: TelephonyEnv;
  livekitReady: boolean;
  dialReady: boolean;
}

export function resolveTelephony(
  loaded: LoadedTelephonyConfig,
  env: TelephonyEnv = telephonyEnv()
): ResolvedTelephony {
  const row = loaded.row;
  const trunkId = row?.sip_outbound_trunk_id?.trim() || env.sipTrunkId;
  return {
    row,
    migrationMissing: loaded.migrationMissing,
    enabled: row?.enabled ?? true,
    trunkId,
    callerId: row?.outbound_caller_id?.trim() || null,
    inboundNumbers: row?.inbound_numbers ?? [],
    recordingEnabled: Boolean(row?.recording_enabled) && env.recordingEnabled,
    transcriptionEnabled: row?.transcription_enabled ?? true,
    queueMaxWaitSeconds:
      row?.queue_max_wait_seconds != null
        ? normalizeQueueMaxWaitSeconds(row.queue_max_wait_seconds) ?? env.queueMaxWaitSeconds
        : env.queueMaxWaitSeconds,
    requiredSkills: normalizeSkillList(row?.required_skills ?? []).skills,
    skillOverflowSeconds:
      normalizeSkillOverflowSeconds(row?.skill_overflow_seconds ?? 0) ?? 0,
    env,
    livekitReady: isLivekitReady(env),
    dialReady: canDialPstn(env, row?.sip_outbound_trunk_id ?? null),
  };
}

/** ¿La cuenta puede iniciar llamadas ahora mismo? */
export function telephonyBlockReason(
  resolved: ResolvedTelephony
): string | null {
  if (resolved.migrationMissing) {
    return 'Falta aplicar la migración 112_telephony.sql en la base de datos.';
  }
  if (!resolved.livekitReady) {
    return 'El servidor no tiene LiveKit configurado.';
  }
  if (!resolved.enabled) {
    return 'La telefonía está desactivada para este negocio.';
  }
  if (!resolved.trunkId) {
    return 'Falta la troncal SIP saliente (LIVEKIT_SIP_TRUNK_ID o Configuración → Telefonía).';
  }
  return null;
}

/**
 * Valida el máximo de espera en cola del negocio (migración 116):
 * entero entre 0 y 3600 segundos; `0` = sin límite.
 */
export function normalizeQueueMaxWaitSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 3600) return null;
  return n;
}

/**
 * Normaliza la lista de números entrantes de un negocio. Descarta
 * inválidos y duplicados; el máximo evita abusos desde la API.
 */
export function normalizeInboundNumbers(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const value of input) {
    const e164 = normalizePhone(value);
    if (e164) seen.add(e164);
    if (seen.size >= 20) break;
  }
  return [...seen];
}

/**
 * Webhook entrante: busca el negocio dueño del número marcado. Si
 * dos negocios reclaman el mismo número gana el primero (el alta
 * valida duplicados en la app, pero la base no lo impide).
 */
export async function findAccountByInboundNumber(
  db: SupabaseClient,
  dialedNumber: string | null | undefined
): Promise<{ accountId: string; row: TelephonyConfig } | null> {
  const e164 = normalizePhone(dialedNumber);
  if (!e164) return null;

  const { data, error } = await db
    .from('telephony_config')
    .select('*')
    .contains('inbound_numbers', [e164])
    .eq('enabled', true)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as TelephonyConfig;
  return { accountId: row.account_id, row };
}

/**
 * Habilidades del agente en este negocio (119). Se lee su propia fila
 * de `account_members`, que la RLS de la 066 sí deja ver. Sin la 119
 * aplicada devuelve `[]`: la cola funciona como antes.
 */
export async function loadAgentSkills(
  db: SupabaseClient,
  accountId: string,
  userId: string
): Promise<string[]> {
  const { data, error } = await db
    .from('account_members')
    .select('agent_skills')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingColumn(error)) return [];
    console.warn('[telephony] no se pudieron leer las habilidades:', error.message);
    return [];
  }

  const raw = (data as { agent_skills?: unknown } | null)?.agent_skills;
  return normalizeSkillList(raw).skills;
}

/**
 * Requisito de habilidad de la cola entrante del negocio. Se usa al
 * crear la sesión para copiarlo en `call_sessions.required_skills`.
 */
export async function loadRequiredSkills(
  db: SupabaseClient,
  accountId: string
): Promise<string[]> {
  const { data, error } = await db
    .from('telephony_config')
    .select('required_skills')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    if (isMissingColumn(error)) return [];
    console.warn('[telephony] no se pudo leer el requisito de habilidades:', error.message);
    return [];
  }

  const raw = (data as { required_skills?: unknown } | null)?.required_skills;
  return normalizeSkillList(raw).skills;
}

/** Columna/tabla que todavía no existe (migración pendiente). */
function isMissingColumn(error: { code?: string }): boolean {
  return (
    error.code === '42703' || // undefined_column
    error.code === '42P01' || // undefined_table
    error.code === 'PGRST204' || // columna desconocida para PostgREST
    error.code === 'PGRST205' // tabla desconocida para PostgREST
  );
}
