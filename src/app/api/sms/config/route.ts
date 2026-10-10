import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { verifyTextbeeCredentials } from '@/lib/sms/textbee'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/sms/config
 *
 * Any member may read the config so the SMS page can reflect whether
 * the account is set up. The encrypted key is NEVER returned — only a
 * `has_key` flag; the settings form shows a masked placeholder.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('sms_config')
      .select('device_id, api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[sms/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load SMS configuration' },
        { status: 500 },
      )
    }

    if (!data) return NextResponse.json({ configured: false })
    return NextResponse.json({
      configured: true,
      device_id: data.device_id,
      has_key: !!data.api_key,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/sms/config  (admin+)
 *
 * Upsert the account's textbee config. The API key is encrypted with
 * AES-256-GCM before it's stored and is never echoed back. When
 * `api_key` is omitted the existing stored key is reused (the form
 * sends it only when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`sms-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const deviceId =
      typeof body.device_id === 'string' ? body.device_id.trim() : ''
    if (!deviceId) return bad('device_id is required')

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    const { data: existing } = await supabase
      .from('sms_config')
      .select('id, api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    let apiKeyPlain: string
    if (rawKey) {
      apiKeyPlain = rawKey
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return bad('Stored API key could not be decrypted — re-enter your key.')
      }
    } else {
      return bad('api_key is required')
    }

    // Verify with textbee before persisting (mirrors the WhatsApp /
    // AI config flows). A 401/403 blocks the save; anything else is
    // treated as best-effort so a flaky gateway can't wedge the form.
    const check = await verifyTextbeeCredentials(deviceId, apiKeyPlain)
    if (!check.ok) return bad(check.error ?? 'Could not validate the textbee credentials.')

    const encryptedKey = rawKey ? encrypt(rawKey) : null
    const shared = { device_id: deviceId }

    if (existing) {
      const { error: upErr } = await supabase
        .from('sms_config')
        .update(encryptedKey ? { ...shared, api_key: encryptedKey } : shared)
        .eq('account_id', accountId)
      if (upErr) {
        console.error('[sms/config POST] update error:', upErr)
        return NextResponse.json(
          { error: 'Failed to save SMS configuration' },
          { status: 500 },
        )
      }
    } else {
      const { error: insErr } = await supabase.from('sms_config').insert({
        account_id: accountId,
        created_by: userId,
        api_key: encryptedKey, // guaranteed non-null: rawKey required when no existing row
        ...shared,
      })
      if (insErr) {
        console.error('[sms/config POST] insert error:', insErr)
        return NextResponse.json(
          { error: 'Failed to save SMS configuration' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/sms/config  (admin+)
 *
 * Removes the account's textbee config. Also used to recover from a
 * corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('sms_config')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[sms/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete SMS configuration' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
