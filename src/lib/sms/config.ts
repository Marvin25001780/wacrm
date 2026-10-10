import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

export interface SmsConfig {
  deviceId: string
  apiKey: string
}

const CONFIG_COLUMNS = 'device_id, api_key'

/**
 * Load and decrypt the account's textbee config for *use* (send /
 * received). Returns `null` when there's no row or the stored key can't
 * be decrypted, so callers can present a single "not configured" state.
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from a worker.
 */
export async function loadSmsConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<SmsConfig | null> {
  const { data, error } = await db
    .from('sms_config')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as { device_id: string | null; api_key: string | null }
  if (!row.device_id || !row.api_key) return null

  try {
    return { deviceId: row.device_id, apiKey: decrypt(row.api_key) }
  } catch {
    // Mismatched ENCRYPTION_KEY or a corrupted row. Treat as "not
    // configured" rather than crashing the request.
    return null
  }
}
