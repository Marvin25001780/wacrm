import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * POST /api/telephony/callbacks/[id]/release — devuelve a la cola una
 * devolución en curso. El agente libera la suya; admin+ puede liberar
 * cualquiera (por ejemplo, si el agente cerró sesión).
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const isAdmin = ctx.role === 'admin' || ctx.role === 'owner';

    let query = ctx.supabase
      .from('callback_requests')
      .update({
        status: 'pending',
        assigned_user_id: null,
        claimed_at: null,
      })
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .eq('status', 'in_progress');

    if (!isAdmin) query = query.eq('assigned_user_id', ctx.userId);

    const { data, error } = await query
      .select('*, contact:contacts(id, name, phone)')
      .maybeSingle();

    if (error) {
      if (isMissingRelation(error)) return migrationMissingResponse();
      throw error;
    }
    if (!data) {
      return NextResponse.json(
        { error: 'La devolución no está en curso o no es tuya.' },
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
