import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/broadcasts/admin-client'
import { sendScheduledBroadcast } from '@/lib/broadcasts/runner'

/**
 * GET /api/broadcasts/cron
 *
 * Barre las campañas masivas programadas cuya hora ya venció y las
 * envía. Pensado para un schedule (Vercel Cron / pinger externo).
 *
 * Auth: secreto compartido vía header `x-cron-secret` que coincide con
 * `AUTOMATION_CRON_SECRET` (el mismo que usan los crons de automatizaciones
 * y flujos, para que los operadores solo provisionen un secreto).
 *
 * La toma del lock (status -> 'sending') evita el doble envío entre
 * invocaciones solapadas.
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
  const { data: due, error } = await admin
    .from('broadcasts')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(25)

  if (error) {
    console.error('[broadcasts-cron] scan failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ processed: 0, results: [] })
  }

  const results: Array<{ id: string; status: string; sent: number; failed: number }> = []
  for (const row of due) {
    try {
      const res = await sendScheduledBroadcast(admin, row.id as string)
      results.push({ id: row.id as string, ...res })
    } catch (err) {
      console.error('[broadcasts-cron] send failed:', err)
      // Best-effort: marca como fallida para que no se reintente en bucle.
      await admin
        .from('broadcasts')
        .update({ status: 'failed' })
        .eq('id', row.id)
      results.push({ id: row.id as string, status: 'failed', sent: 0, failed: 0 })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}
