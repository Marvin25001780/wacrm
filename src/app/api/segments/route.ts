import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { validateRules } from '@/lib/segments/rules'
import type { SegmentEntity } from '@/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function isEntity(v: unknown): v is SegmentEntity {
  return v === 'contacts' || v === 'leads'
}

/**
 * GET /api/segments
 * Lista los segmentos de la cuenta (RLS: cualquier miembro).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('segments')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ data: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/segments
 * Crea un segmento. Requiere rol agent+.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const limited = checkRateLimit(
      `segments:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return bad('El nombre es obligatorio')
    if (name.length > 120) return bad('El nombre es demasiado largo')

    const entity = body.entity
    if (!isEntity(entity)) return bad('entity debe ser "contacts" o "leads"')

    const checked = validateRules(entity, body.rules ?? [])
    if (!checked.ok) return bad(checked.error)

    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null

    const { data, error } = await ctx.supabase
      .from('segments')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        name,
        description,
        entity,
        rules: checked.rules,
      })
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
