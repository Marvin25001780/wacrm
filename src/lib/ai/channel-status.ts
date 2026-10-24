import type { SupabaseClient } from '@supabase/supabase-js'

import type { AiChannelStatus } from './channels'

/**
 * Qué canales tiene conectados la cuenta ahora mismo.
 *
 * Solo devuelve booleanos: nunca credenciales. La UI lo usa para no
 * dejar activar un agente sin ningún canal operativo; el motor vuelve
 * a comprobar la conexión real al enviar.
 */
export async function loadAiChannelStatus(
  db: SupabaseClient,
  accountId: string,
): Promise<AiChannelStatus> {
  const [whatsapp, evolution, sms, meta] = await Promise.all([
    db
      .from('whatsapp_config')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId),
    db
      .from('channel_configs')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('channel', 'evolution')
      .eq('is_active', true),
    db
      .from('sms_config')
      .select('device_id, api_key')
      .eq('account_id', accountId)
      .maybeSingle(),
    db
      .from('channel_configs')
      .select('channel')
      .eq('account_id', accountId)
      .in('channel', ['instagram', 'facebook'])
      .eq('is_active', true),
  ])

  const metaChannels = new Set(
    (meta.data ?? []).map((row) => (row as { channel?: string }).channel),
  )
  const smsRow = sms.data as
    | { device_id?: string | null; api_key?: string | null }
    | null
    | undefined

  return {
    whatsapp: (whatsapp.count ?? 0) > 0 || (evolution.count ?? 0) > 0,
    sms: Boolean(smsRow?.device_id && smsRow?.api_key),
    instagram: metaChannels.has('instagram'),
    facebook: metaChannels.has('facebook'),
  }
}
