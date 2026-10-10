import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { loadSmsConfig } from '@/lib/sms/config'
import { textbeeFetchReceived } from '@/lib/sms/textbee'
import { syncInboundSms } from '@/lib/sms/persist'

/**
 * POST /api/sms/received
 *
 * Returns recently received SMS for the account's configured textbee
 * device, and records any new ones in the CRM (channel = 'sms') so
 * they surface in the shared inbox and the metrics widget.
 * Credentials are loaded and decrypted server-side.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount()

    const config = await loadSmsConfig(supabase, accountId)
    if (!config) return NextResponse.json({ messages: [] })

    const result = await textbeeFetchReceived(config.deviceId, config.apiKey)
    const messages = result.ok ? result.data : []

    if (messages.length) {
      // Best-effort: never fail the feed because persistence hiccuped.
      try {
        await syncInboundSms(supabase, accountId, userId, messages)
      } catch (persistErr) {
        console.error(
          '[sms/received] persist failed:',
          persistErr instanceof Error ? persistErr.message : persistErr,
        )
      }
    }

    return NextResponse.json({ messages })
  } catch (err) {
    return toErrorResponse(err)
  }
}
