import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * POST /api/telephony/callbacks/[id]/cancel — cancela una devolución
 * pendiente o en curso (admin+). No borra la fila: queda el rastro de
 * quién la descartó.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await context.params;

    const { data, error } = await ctx.supabase
      .from('callback_requests')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        completed_by: ctx.userId,
      })
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .in('status', ['pending', 'in_progress'])
      .select('*, contact:contacts(id, name, phone)')
      .maybeSingle();

    if (error) {
      if (isMissingRelation(error)) return migrationMissingResponse();
      throw error;
    }
    if (!data) {
      return NextResponse.json(
        { error: 'La devolución no existe o ya está cerrada.' },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, callback: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function isMissingRelation(error: { code?: string }): boolean {
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === '42703'
  );
}

function migrationMissingResponse() {
  return NextResponse.json(
    {
      error:
        'Falta aplicar la migración 122_callback_requests.sql (devoluciones de llamadas).',
    },
    { status: 400 }
  );
}
