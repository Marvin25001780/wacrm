import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadSmsConfig } from '@/lib/sms/config'
import { textbeeSendSms } from '@/lib/sms/textbee'
import { recordOutboundSms, extractGatewayMessageId } from '@/lib/sms/persist'

/**
 * POST /api/sms/send
 *
 * Sends a single SMS through the account's configured textbee device.
 * Credentials are loaded and decrypted server-side — the client never
 * sends (or sees) them.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount()

    const limit = checkRateLimit(`sms-send:${userId}`, RATE_LIMITS.smsSend)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const to = typeof body.to === 'string' ? body.to.trim() : ''
    const message = typeof body.message === 'string' ? body.message.trim() : ''

    if (!to || !message) {
      return NextResponse.json(
        { error: 'to and message are required' },
        { status: 400 },
      )
    }

    const config = await loadSmsConfig(supabase, accountId)
    if (!config) {
      return NextResponse.json(
        {
          error:
            'SMS is not configured. An admin must add the textbee device id and API key in the SMS page settings.',
        },
        { status: 400 },
      )
    }

    const result = await textbeeSendSms(config.deviceId, config.apiKey, to, message)
    if (!result.ok) {
      console.error('sms send error:', result.status, result.error)
      return NextResponse.json(
        { error: 'Failed to send SMS. Check your textbee credentials.' },
        { status: 502 },
      )
    }

    // Record the send in the CRM so SMS shows up in the inbox and in
    // the "Mensajería por canal" metrics. Best-effort: the SMS already
    // went out, so a DB hiccup must not turn a success into an error.
    try {
      await recordOutboundSms(
        supabase,
        accountId,
        userId,
        to,
        message,
        extractGatewayMessageId(result.data),
      )
    } catch (persistErr) {
      console.error(
        '[sms/send] persist failed:',
        persistErr instanceof Error ? persistErr.message : persistErr,
      )
    }

    return NextResponse.json({ success: true, data: result.data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
