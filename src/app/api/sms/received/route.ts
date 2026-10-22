import { NextResponse, after } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { loadSmsConfig } from '@/lib/sms/config'
import { textbeeFetchReceived } from '@/lib/sms/textbee'
import { syncInboundSms, type StoredInboundSms } from '@/lib/sms/persist'

export const maxDuration = 60

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

    let storedMessages: StoredInboundSms[] = []
    if (messages.length) {
      // Best-effort: never fail the feed because persistence hiccuped.
      try {
        const out = await syncInboundSms(supabase, accountId, userId, messages)
        storedMessages = out.storedMessages
      } catch (persistErr) {
        console.error(
          '[sms/received] persist failed:',
          persistErr instanceof Error ? persistErr.message : persistErr,
        )
      }
    }

    // La respuesta de IA se ejecuta después de devolver el feed, para
    // no retrasar el polling del inbox. Solo mensajes nuevos.
    if (storedMessages.length) {
      after(async () => {
        for (const inbound of storedMessages) {
          try {
            await dispatchInboundToAiReply({
              accountId,
              conversationId: inbound.conversationId,
              contactId: inbound.contactId,
              configOwnerUserId: userId,
            })
          } catch (err) {
            console.error('[sms/received] ai auto-reply failed:', err)
          }
        }
      })
    }

    return NextResponse.json({ messages })
  } catch (err) {
    return toErrorResponse(err)
  }
}
