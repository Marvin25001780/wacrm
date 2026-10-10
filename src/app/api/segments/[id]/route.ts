import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { validateRules } from '@/lib/segments/rules'
import type { SegmentEntity } from '@/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function isEntity(v: unknown): v is SegmentEntity {
  return v === 'contacts' || v === 'leads'
}

/**
 * PATCH /api/segments/[id]
 * Actualiza nombre, descripción o reglas. Requiere agent+.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('agent')

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >

    const { data: existing, error: fetchErr } = await ctx.supabase
      .from('segments')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (fetchErr) throw fetchErr
    if (!existing) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const patch: Record<string, unknown> = {}

    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name) return bad('El nombre es obligatorio')
      if (name.length > 120) return bad('El nombre es demasiado largo')
      patch.name = name
    }

    if ('description' in body) {
      patch.description =
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : null
    }

    const entity = isEntity(body.entity) ? body.entity : (existing.entity as SegmentEntity)
    if ('entity' in body) {
      if (!isEntity(body.entity)) return bad('entity debe ser "contacts" o "leads"')
      patch.entity = entity
    }

    if ('rules' in body) {
      const checked = validateRules(entity, body.rules ?? [])
      if (!checked.ok) return bad(checked.error)
      patch.rules = checked.rules
    }

    if (Object.keys(patch).length === 0) return bad('Nada que actualizar')

    const { data, error } = await ctx.supabase
      .from('segments')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/segments/[id]
 * Elimina un segmento. Requiere agent+.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const { supabase, accountId } = await getCurrentAccount()
    // getCurrentAccount doesn't enforce role; do it explicitly.
    await requireRole('agent')

    const { error } = await supabase
      .from('segments')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
