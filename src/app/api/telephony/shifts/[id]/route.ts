import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * DELETE /api/telephony/shifts/[id] — borra un turno del negocio (admin+).
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await context.params;

    const { error, count } = await ctx.supabase
      .from('agent_shifts')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      if (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        error.code === '42703'
      ) {
        return NextResponse.json(
          { error: 'Falta aplicar la migración 120_wem_adherence.sql.' },
          { status: 400 }
        );
      }
      throw error;
    }

    if (!count) {
      return NextResponse.json(
        { error: 'Turno no encontrado.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
