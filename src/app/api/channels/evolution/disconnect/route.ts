import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  evoInstanceName,
  evolutionDelete,
  evolutionLogout,
} from '@/lib/channels/evolution'

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * POST /api/channels/evolution/disconnect
 *
 * Desvincula el WhatsApp (logout + delete de la instancia en Evolution,
 * best-effort) y elimina la fila `channel_configs`. Requiere admin+.
 */
export async function POST() {
  try {
    const ctx = await requireRole('admin')
    const limited = checkRateLimit(
      `channels-evo-disconnect:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limited.success) return rateLimitResponse(limited)

    const { data: existing } = await ctx.supabase
      .from('channel_configs')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('channel', 'evolution')
      .maybeSingle()

    if (existing) {
      const config = (existing.config ?? {}) as Record<string, unknown>
      const baseUrl = str(config.base_url)
      const instance = str(config.instance) || evoInstanceName(ctx.accountId)

      if (baseUrl && typeof config.api_key === 'string') {
        try {
          const creds = { baseUrl, apiKey: decrypt(config.api_key) }
          await evolutionLogout(creds, instance)
          await evolutionDelete(creds, instance)
        } catch (err) {
          console.warn(
            '[channels/evolution/disconnect] Evolution cleanup failed:',
            err instanceof Error ? err.message : err,
          )
        }
      }

      await ctx.supabase
        .from('channel_configs')
        .delete()
        .eq('id', existing.id)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
