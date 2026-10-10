import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  evoInstanceName,
  evolutionConnectionState,
  evolutionSetWebhook,
} from '@/lib/channels/evolution'

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * POST /api/channels/evolution/status
 *
 * Consulta el estado de conexión de la instancia y, cuando WhatsApp
 * confirma el emparejamiento (`state = open`), activa el canal
 * (`channel_configs.is_active = true`) y re-asegura el webhook.
 * La UI lo sondea durante el escaneo del QR. Requiere admin+.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limited = checkRateLimit(
      `channels-evo-status:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limited.success) return rateLimitResponse(limited)

    // Body opcional (la UI puede mandar la instancia abierta del modal).
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const { data: existing } = await ctx.supabase
      .from('channel_configs')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('channel', 'evolution')
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ state: 'close', connected: false })
    }

    const config = (existing.config ?? {}) as Record<string, unknown>
    const baseUrl = str(body.base_url) || str(config.base_url)
    const instance = str(body.instance) || str(config.instance) || evoInstanceName(ctx.accountId)

    let apiKey = str(body.api_key)
    if (!apiKey && typeof config.api_key === 'string') {
      try {
        apiKey = decrypt(config.api_key)
      } catch {
        apiKey = ''
      }
    }

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ state: 'close', connected: false })
    }

    const creds = { baseUrl, apiKey }
    const state = await evolutionConnectionState(creds, instance)
    if (!state.ok) {
      return NextResponse.json({
        state: 'close',
        connected: false,
        error: state.error,
      })
    }

    if (state.data.connected && !existing.is_active) {
      await ctx.supabase
        .from('channel_configs')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', existing.id)

      const webhookUrl = `${new URL(request.url).origin}/api/webhooks/evolution/${existing.id}`
      await evolutionSetWebhook(creds, instance, webhookUrl)
    }

    return NextResponse.json({
      state: state.data.state,
      connected: state.data.connected,
      instance,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
