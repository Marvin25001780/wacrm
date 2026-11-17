import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { CallbackRequest } from '@/types';

/**
 * POST /api/telephony/callbacks/[id]/complete — marca la devolución
 * como atendida. Body opcional: { callSessionId } para vincular la
 * saliente que se hizo desde el CRM.
 *
 * Cualquier agente puede cerrar una pendiente (si llamó por fuera);
 * una en curso solo la cierra su dueño o un admin+.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      callSessionId?: unknown;
    };
    const isAdmin = ctx.role === 'admin' || ctx.role === 'owner';

    const { data: current, error: currentError } = await ctx.supabase
      .from('callback_requests')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();

    if (currentError) {
      if (isMissingRelation(currentError)) return migrationMissingResponse();
      throw currentError;
    }
    if (!current) {
      return NextResponse.json(
        { error: 'Devolución no encontrada.' },
        { status: 404 }
      );
    }

    const row = current as CallbackRequest;
    if (row.status === 'done' || row.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Esa devolución ya está cerrada.' },
        { status: 409 }
      );
    }
    if (row.assigned_user_id && row.assigned_user_id !== ctx.userId && !isAdmin) {
      return NextResponse.json(
        { error: 'La devolución está asignada a otra persona.' },
        { status: 403 }
      );
    }

    let callSessionId: string | null = null;
    if (
      typeof body.callSessionId === 'string' &&
      body.callSessionId.length > 0
    ) {
      const { data: call, error: callError } = await ctx.supabase
        .from('call_sessions')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('id', body.callSessionId)
        .maybeSingle();
      if (callError) throw callError;
      if (!call) {
        return NextResponse.json(
          { error: 'La llamada indicada no pertenece a este negocio.' },
          { status: 400 }
        );
      }
      callSessionId = call.id as string;
    }

    const { data, error } = await ctx.supabase
      .from('callback_requests')
      .update({
        status: 'done',
        assigned_user_id: row.assigned_user_id ?? ctx.userId,
        completed_at: new Date().toISOString(),
        completed_by: ctx.userId,
        ...(callSessionId ? { call_session_id: callSessionId } : {}),
      })
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .eq('status', row.status)
      .select('*, contact:contacts(id, name, phone)')
      .maybeSingle();

    if (error) {
      if (isMissingRelation(error)) return migrationMissingResponse();
      throw error;
    }
    if (!data) {
      return NextResponse.json(
        { error: 'La devolución cambió de estado. Recarga la lista.' },
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
