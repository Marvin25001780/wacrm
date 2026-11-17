import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * POST /api/telephony/callbacks/[id]/claim — reclama una devolución
 * pendiente (agente+). El UPDATE es atómico: solo gana quien llega
 * primero a `status = 'pending'`.
 *
 * Un agente no puede tener dos devoluciones en curso a la vez.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;

    const { data: current, error: currentError } = await ctx.supabase
      .from('callback_requests')
      .select('id, status')
      .eq('account_id', ctx.accountId)
      .eq('assigned_user_id', ctx.userId)
      .eq('status', 'in_progress')
      .maybeSingle();

    if (currentError) {
      if (isMissingRelation(currentError)) return migrationMissingResponse();
      throw currentError;
    }
    if (current && current.id !== id) {
      return NextResponse.json(
        {
          error:
            'Ya tienes una devolución en curso. Termínala o libérala antes de tomar otra.',
        },
        { status: 409 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('callback_requests')
      .update({
        status: 'in_progress',
        assigned_user_id: ctx.userId,
        claimed_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .eq('status', 'pending')
      .select('*, contact:contacts(id, name, phone)')
      .maybeSingle();

    if (error) {
      if (isMissingRelation(error)) return migrationMissingResponse();
      throw error;
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Esa devolución ya fue tomada por otra persona.' },
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
