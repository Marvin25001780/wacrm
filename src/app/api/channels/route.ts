import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { serializeChannelConfig } from '@/lib/channels/config'

/**
 * GET /api/channels
 * Lista los canales configurados de la cuenta (cualquier miembro).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('channel_configs')
      .select('*')
      .eq('account_id', accountId)
      .order('channel', { ascending: true })

    if (error) throw error
    return NextResponse.json({
      data: (data ?? []).map((r) =>
        serializeChannelConfig(r as Record<string, unknown>),
      ),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
