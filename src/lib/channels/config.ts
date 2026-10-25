import { encrypt } from '@/lib/whatsapp/encryption'
import type { ChannelType } from '@/types'

// ============================================================
// Configuración de canales omnicanal — serialización y fusión.
//
// Los secretos (api_key / api_token) se guardan cifrados (AES-256-GCM,
// igual que los tokens de WhatsApp) y NUNCA se devuelven al cliente:
// `serializeChannelConfig` los omite y expone banderas `has_*`. Al
// guardar, `mergeChannelConfig` cifra el secreto si viene, o conserva
// el existente si el campo llega vacío (para no obligar a re-teclearlo
// en cada edición).
// ============================================================

export const CHANNEL_TYPES: ChannelType[] = [
  'evolution',
  'chatwoot',
  'instagram',
  'facebook',
  'tiktok',
]

export const CHANNEL_LABEL: Record<ChannelType, string> = {
  evolution: 'WhatsApp (Evolution API)',
  chatwoot: 'Chatwoot',
  instagram: 'Instagram Direct',
  facebook: 'Facebook Messenger',
  tiktok: 'TikTok',
}

const SECRET_FIELDS: Record<ChannelType, string[]> = {
  evolution: ['api_key'],
  chatwoot: ['api_token'],
  instagram: ['access_token', 'app_secret'],
  facebook: ['access_token', 'app_secret'],
  tiktok: ['access_token', 'refresh_token'],
}

/** Campos de texto no secretos que se aceptan por canal. */
const PUBLIC_FIELDS: Record<ChannelType, string[]> = {
  evolution: ['base_url', 'instance'],
  chatwoot: ['base_url', 'account_id'],
  instagram: ['page_id', 'page_name', 'verify_token'],
  facebook: ['page_id', 'page_name', 'verify_token'],
  tiktok: ['open_id', 'display_name', 'username'],
}

export function isChannelType(v: unknown): v is ChannelType {
  return (
    v === 'evolution' ||
    v === 'chatwoot' ||
    v === 'instagram' ||
    v === 'facebook' ||
    v === 'tiktok'
  )
}

export interface SerializedChannel {
  id: string;
  account_id: string;
  channel: ChannelType;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Quita secretos y añade banderas `has_<secreto>`. */
export function serializeChannelConfig(row: Record<string, unknown>): SerializedChannel {
  const channel = row.channel as ChannelType
  const raw = (row.config ?? {}) as Record<string, unknown>
  const config: Record<string, unknown> = {}

  for (const field of PUBLIC_FIELDS[channel] ?? []) {
    config[field] = typeof raw[field] === 'string' ? raw[field] : ''
  }
  for (const secret of SECRET_FIELDS[channel] ?? []) {
    config[`has_${secret}`] = typeof raw[secret] === 'string' && raw[secret].length > 0
  }

  return {
    id: row.id as string,
    account_id: row.account_id as string,
    channel,
    config,
    is_active: Boolean(row.is_active),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  } as SerializedChannel
}

export type MergeResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Fusiona la config entrante con la existente, validando y cifrando
 * los secretos. `existing` es el `config` jsonb ya guardado (o {}).
 */
export function mergeChannelConfig(
  channel: ChannelType,
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
): MergeResult {
  const config: Record<string, unknown> = {}

  for (const field of PUBLIC_FIELDS[channel]) {
    const value = incoming[field]
    if (typeof value !== 'string' || !value.trim()) {
      return { ok: false, error: `El campo "${field}" es obligatorio` }
    }
    config[field] = value.trim()
  }

  // base_url debe ser http(s) — solo en los canales que la usan
  // (Evolution / Chatwoot). Los canales de Meta no tienen base_url.
  if (PUBLIC_FIELDS[channel].includes('base_url')) {
    const baseUrl = config.base_url as string
    if (!/^https?:\/\//i.test(baseUrl)) {
      return { ok: false, error: 'La URL base debe empezar por http:// o https://' }
    }
  }

  for (const secret of SECRET_FIELDS[channel]) {
    const value = incoming[secret]
    const hasIncoming = typeof value === 'string' && value.trim().length > 0
    if (hasIncoming) {
      config[secret] = encrypt((value as string).trim())
    } else if (typeof existing[secret] === 'string' && existing[secret]) {
      // Sin valor nuevo → conservamos el secreto ya guardado.
      config[secret] = existing[secret]
    } else {
      return { ok: false, error: `El campo "${secret}" es obligatorio la primera vez` }
    }
  }

  return { ok: true, config }
}
