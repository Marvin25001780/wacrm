import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { textbeeFetchReceived } from '@/lib/sms/textbee'
import { syncInboundSms } from '@/lib/sms/persist'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'

/**
 * GET /api/sms/cron
 *
 * Drains newly received SMS from every account's textbee device into
 * the CRM (`messages.channel = 'sms'`) so inbound texts land in the
 * shared inbox and the metrics widget even when nobody has the SMS
 * page open. The dashboard's own polling keeps the live feed fresh;
 * this is the gap-filler for a scheduled pinger.
 *
 * Meant to be hit on a schedule (Vercel Cron / external pinger) —
 * requires a shared secret via the `x-cron-secret` header matching
 * `AUTOMATION_CRON_SECRET`, the same contract as the other crons.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const { data: configs, error } = await admin
    .from('sms_config')
    .select('account_id, device_id, api_key')
  if (error) {
    console.error('[sms/cron] config fetch error:', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }

  let accounts = 0
  let stored = 0
  let skipped = 0

  for (const cfg of configs ?? []) {
    const accountId = cfg.account_id as string
    const deviceId = cfg.device_id as string | null
    const encryptedKey = cfg.api_key as string | null
    if (!deviceId || !encryptedKey) continue

    let apiKey: string
    try {
      apiKey = decrypt(encryptedKey)
    } catch {
      // Mismatched ENCRYPTION_KEY / corrupted row — skip this account.
      continue
    }

    const result = await textbeeFetchReceived(deviceId, apiKey)
    if (!result.ok || result.data.length === 0) continue

    let userId: string
    try {
      userId = await resolveAuditUserId(admin, accountId)
    } catch (err) {
      console.error(
        '[sms/cron] audit user unresolved for',
        accountId,
        err instanceof Error ? err.message : err,
      )
      continue
    }

    const out = await syncInboundSms(admin, accountId, userId, result.data)
    accounts++
    stored += out.stored
    skipped += out.skipped
  }

  return NextResponse.json({ accounts, stored, skipped })
}
