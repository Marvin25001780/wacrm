import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { mergeChannelConfig } from '@/lib/channels/config'
import {
  evoInstanceName,
  evolutionConnect,
  evolutionCreateInstance,
  evolutionSetWebhook,
} from '@/lib/channels/evolution'

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * POST /api/channels/evolution/connect
 *
 * Aprovisiona (o reconecta) la instancia de Evolution API del número de
 * WhatsApp de la cuenta y devuelve el QR de emparejamiento — el único
 * "QR escaneable" real. El flujo:
 *
 *   1. Resuelve credenciales (base_url + apikey global), reusando las
 *      guardadas si el cliente no reescribe el secreto.
 *   2. Crea la instancia en Evolution (si ya existe, continúa).
 *   3. Persiste la fila `channel_configs` (inactiva) para obtener su id.
 *   4. Registra el webhook de ingesta apuntando a ese id (automático).
 *   5. Pide el QR y lo devuelve como data URI.
 *
 * La fila NO se marca activa aquí: `.../status` la activa cuando
 * WhatsApp confirma el emparejamiento (`state = open`). Requiere admin+.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limited = checkRateLimit(
      `channels-evo-connect:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const bodyBaseUrl = str(body.base_url)
    const bodyApiKey = str(body.api_key)

    const { data: existing } = await ctx.supabase
      .from('channel_configs')
      .select('config')
      .eq('account_id', ctx.accountId)
      .eq('channel', 'evolution')
      .maybeSingle()
    const existingConfig = (existing?.config as Record<string, unknown> | undefined) ?? {}

    const baseUrl = bodyBaseUrl || str(existingConfig.base_url)
    if (!baseUrl) return bad('Falta la URL base de Evolution')
    if (!/^https?:\/\//i.test(baseUrl)) {
      return bad('La URL base debe empezar por http:// o https://')
    }

    // Si el cliente no reescribe el secreto, reutilizamos el guardado.
    let apiKey = bodyApiKey
    if (!apiKey && typeof existingConfig.api_key === 'string') {
      try {
        apiKey = decrypt(existingConfig.api_key)
      } catch {
        apiKey = ''
      }
    }
    if (!apiKey) return bad('Falta la API key de Evolution')

    const instance = str(existingConfig.instance) || evoInstanceName(ctx.accountId)
    const creds = { baseUrl, apiKey }

    // 1) Crear la instancia (idempotente).
    const created = await evolutionCreateInstance(creds, instance)
    if (!created.ok) {
      return bad(
        created.error || 'No se pudo crear la instancia en Evolution API',
        502,
      )
    }

    // 2) Persistir la fila para obtener su id (el webhook lo usa).
    const merged = mergeChannelConfig(
      'evolution',
      { base_url: baseUrl, instance, api_key: bodyApiKey },
      existingConfig,
    )
    if (!merged.ok) return bad(merged.error)

    const { data: row, error } = await ctx.supabase
      .from('channel_configs')
      .upsert(
        {
          account_id: ctx.accountId,
          channel: 'evolution',
          config: merged.config,
          is_active: false,
        },
        { onConflict: 'account_id,channel' },
      )
      .select('*')
      .single()

    if (error || !row) return bad(error?.message ?? 'No se pudo guardar el canal', 500)

    // 3) Registrar el webhook (best-effort; el estado lo re-asegura).
    const webhookUrl = `${new URL(request.url).origin}/api/webhooks/evolution/${row.id}`
    const hook = await evolutionSetWebhook(creds, instance, webhookUrl)
    if (!hook.ok) {
      console.warn('[channels/evolution/connect] setWebhook failed:', hook.error)
    }

    // 4) QR de emparejamiento.
    const connected = await evolutionConnect(creds, instance)
    if (!connected.ok) {
      return bad(connected.error || 'No se pudo obtener el QR', 502)
    }

    return NextResponse.json({
      instance,
      base_url: baseUrl,
      qr: connected.data.qr,
      code: connected.data.code,
      webhook_url: webhookUrl,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
