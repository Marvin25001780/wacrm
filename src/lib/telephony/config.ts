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
