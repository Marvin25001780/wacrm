// ============================================================
// Configuración de integraciones externas por cuenta.
//
// OpenReplay (sesiones), Listmonk (boletines) y VoiceSummary
// (transcripciones) son servicios autoalojados que se consumen por API
// o por el tracker oficial. El CRM nunca copia su código.
//
// Los tokens viven cifrados en `external_integrations` y solo los lee
// el servidor. Este módulo centraliza la lectura y la validación para
// que las rutas no repitan la misma lógica.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

export type ExternalIntegrationKind = 'openreplay' | 'listmonk' | 'voicesummary';

export interface OpenreplaySettings {
  enabled: boolean;
  url: string | null;
  projectKey: string | null;
}

export interface ListmonkSettings {
  enabled: boolean;
  url: string | null;
  user: string | null;
  token: string | null;
  listId: number | null;
}

export interface VoicesummarySettings {
  enabled: boolean;
  url: string | null;
  token: string | null;
}

export interface ExternalIntegrations {
  openreplay: OpenreplaySettings;
  listmonk: ListmonkSettings;
  voicesummary: VoicesummarySettings;
}

/** Fila tal como está en la base (snake_case, tokens cifrados). */
export interface ExternalIntegrationsRow {
  account_id: string;
  openreplay_enabled: boolean;
  openreplay_url: string | null;
  openreplay_project_key: string | null;
  listmonk_enabled: boolean;
  listmonk_url: string | null;
  listmonk_user: string | null;
  listmonk_token: string | null;
  listmonk_list_id: number | null;
  voicesummary_enabled: boolean;
  voicesummary_url: string | null;
  voicesummary_token: string | null;
}

const EMPTY: ExternalIntegrations = {
  openreplay: { enabled: false, url: null, projectKey: null },
  listmonk: { enabled: false, url: null, user: null, token: null, listId: null },
  voicesummary: { enabled: false, url: null, token: null },
};

/**
 * Normaliza una URL base: recorta espacios, quita la barra final y
 * exige `http://` o `https://`. Devuelve `null` si no sirve. Se acepta
 * HTTP porque Listmonk/OpenReplay suelen correr en la red interna;
 * en producción conviene HTTPS.
 */
export function normalizeIntegrationUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().replace(/\/+$/, '');
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return value;
}

/** El tracker de OpenReplay necesita una project key no vacía. */
export function normalizeProjectKey(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  return value ? value : null;
}

function safeDecrypt(value: string | null): string | null {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch (error) {
    console.error(
      '[external-integrations] no se pudo descifrar un token:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** `true` cuando la migración 132 todavía no está aplicada. */
export function isMissingIntegrationsTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

/**
 * Carga la configuración descifrada de la cuenta. Devuelve `null` si
 * no hay fila o si la migración 132 no está aplicada (las pantallas
 * muestran el estado "sin configurar" en vez de romperse).
 */
export async function loadExternalIntegrations(
  db: SupabaseClient,
  accountId: string,
): Promise<ExternalIntegrations | null> {
  const { data, error } = await db
    .from('external_integrations')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle<ExternalIntegrationsRow>();

  if (error) {
    if (isMissingIntegrationsTable(error)) return null;
    throw error;
  }
  if (!data) {
    return {
      openreplay: { ...EMPTY.openreplay },
      listmonk: { ...EMPTY.listmonk },
      voicesummary: { ...EMPTY.voicesummary },
    };
  }

  return {
    openreplay: {
      enabled: data.openreplay_enabled,
      url: data.openreplay_url,
      projectKey: data.openreplay_project_key,
    },
    listmonk: {
      enabled: data.listmonk_enabled,
      url: data.listmonk_url,
      user: data.listmonk_user,
      token: safeDecrypt(data.listmonk_token),
      listId: data.listmonk_list_id,
    },
    voicesummary: {
      enabled: data.voicesummary_enabled,
      url: data.voicesummary_url,
      token: safeDecrypt(data.voicesummary_token),
    },
  };
}

/** Config pública de OpenReplay para el tracker del navegador. */
export function publicOpenreplayConfig(config: ExternalIntegrations | null): {
  enabled: boolean;
  url: string | null;
  projectKey: string | null;
} {
  const openreplay = config?.openreplay;
  return {
    enabled: Boolean(openreplay?.enabled && openreplay.url && openreplay.projectKey),
    url: openreplay?.url ?? null,
    projectKey: openreplay?.projectKey ?? null,
  };
}

export interface ExternalIntegrationsView {
  configured: boolean;
  openreplay: { enabled: boolean; url: string; project_key: string };
  listmonk: {
    enabled: boolean;
    url: string;
    user: string;
    list_id: number | null;
    has_token: boolean;
  };
  voicesummary: { enabled: boolean; url: string; has_token: boolean };
}

/** Vista para el panel de Ajustes: sin secretos, solo `has_token`. */
export function toClientView(
  config: ExternalIntegrations | null,
  row: Pick<
    ExternalIntegrationsRow,
    'listmonk_token' | 'voicesummary_token'
  > | null,
): ExternalIntegrationsView {
  return {
    configured: Boolean(row),
    openreplay: {
      enabled: config?.openreplay.enabled ?? false,
      url: config?.openreplay.url ?? '',
      project_key: config?.openreplay.projectKey ?? '',
    },
    listmonk: {
      enabled: config?.listmonk.enabled ?? false,
      url: config?.listmonk.url ?? '',
      user: config?.listmonk.user ?? '',
      list_id: config?.listmonk.listId ?? null,
      has_token: Boolean(row?.listmonk_token),
    },
    voicesummary: {
      enabled: config?.voicesummary.enabled ?? false,
      url: config?.voicesummary.url ?? '',
      has_token: Boolean(row?.voicesummary_token),
    },
  };
}

/**
 * Reutiliza un token guardado cuando el formulario llega vacío; si el
 * usuario escribe uno nuevo, lo cifra. `undefined` significa "no lo
 * toques" y `''` significa "bórralo".
 */
export async function resolveSecret(
  db: SupabaseClient,
  accountId: string,
  column: 'listmonk_token' | 'voicesummary_token',
  incoming: unknown,
): Promise<string | null | undefined> {
  if (incoming === undefined) return undefined;

  const value = typeof incoming === 'string' ? incoming.trim() : '';
  if (!value) {
    // Vacío = borrar el token guardado.
    return null;
  }
  if (value.startsWith('••')) {
    // El formulario reenvía el placeholder: conserva el guardado.
    const { data } = await db
      .from('external_integrations')
      .select(column)
      .eq('account_id', accountId)
      .maybeSingle<Record<string, string | null>>();
    return data?.[column] ?? null;
  }
  return encrypt(value);
}
