import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { allModuleKeys, normalizeModules } from '@/lib/modules'

/**
 * PATCH /api/account/modules
 *
 * Reemplaza los módulos habilitados del negocio activo. Solo admin+.
 * Body: { modules: string[] }
 *
 * Se guarda `NULL` cuando están todos, para que las cuentas nuevas y
 * las existentes compartan la misma semántica ("sin restricción").
 */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const body = (await request.json().catch(() => ({}))) as {
      modules?: unknown
    }
    const modules = normalizeModules(body.modules)
    if (modules.length === 0) {
      return NextResponse.json(
        { error: 'Selecciona al menos un módulo.' },
        { status: 400 },
      )
    }

    const all = allModuleKeys()
    const stored: string[] | null =
      modules.length === all.length ? null : modules

    const { error } = await ctx.supabase
      .from('accounts')
      .update({ enabled_modules: stored })
      .eq('id', ctx.accountId)

    if (error) {
      if (error.code === '42703') {
        return NextResponse.json(
          {
            error:
              'Falta aplicar la migración 080_account_modules.sql en la base de datos.',
          },
          { status: 400 },
        )
      }
      throw error
    }

    return NextResponse.json({ ok: true, modules: stored ?? all })
  } catch (err) {
    return toErrorResponse(err)
  }
}
