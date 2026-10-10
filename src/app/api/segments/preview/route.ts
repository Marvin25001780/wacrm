import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { compileRules, validateRules } from '@/lib/segments/rules'
import type { SegmentEntity } from '@/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function isEntity(v: unknown): v is SegmentEntity {
  return v === 'contacts' || v === 'leads'
}

/**
 * POST /api/segments/preview
 * Evalúa reglas sin guardarlas y devuelve cuántos registros coinciden
 * más una muestra. Cualquier miembro puede previsualizar.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    if (!isEntity(body.entity)) return bad('entity debe ser "contacts" o "leads"')

    const checked = validateRules(body.entity, body.rules ?? [])
    if (!checked.ok) return bad(checked.error)

    const filters = compileRules(body.entity, checked.rules)

    let q = supabase
      .from(body.entity)
      .select('*', { count: 'exact' })
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(5)

    for (const f of filters) {
      if (f.method === 'eq') q = q.eq(f.column, f.value)
      else if (f.method === 'neq') q = q.neq(f.column, f.value)
      else if (f.method === 'ilike') q = q.ilike(f.column, f.value as string)
      else if (f.method === 'gt') q = q.gt(f.column, f.value as string)
      else if (f.method === 'lt') q = q.lt(f.column, f.value as string)
      else if (f.method === 'is') q = q.is(f.column, null)
      else if (f.method === 'not_is') q = q.not(f.column, 'is', null)
    }

    const { data, count, error } = await q
    if (error) throw error

    return NextResponse.json({ count: count ?? 0, sample: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
