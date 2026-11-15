import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { CallEvent, CallSession } from '@/types';

/**
 * GET /api/telephony/calls/[id] — detalle de una llamada + bitácora.
 *
 * El historial ya trae las filas; este endpoint añade los eventos
 * (`call_events`) para el diálogo de detalle. RLS y `account_id`
 * impiden leer llamadas de otro negocio.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;

    const { data, error } = await ctx.supabase
      .from('call_sessions')
      .select('*, contact:contacts(id, name, phone)')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'Llamada no encontrada.' },
        { status: 404 }
      );
    }

    const { data: events, error: eventsError } = await ctx.supabase
      .from('call_events')
      .select('*')
      .eq('call_id', id)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (eventsError) throw eventsError;

    return NextResponse.json({
      call: data as CallSession,
      events: (events ?? []) as CallEvent[],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
