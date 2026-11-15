import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isTerminalCallStatus } from '@/lib/telephony/calls';
import { isCallDisposition, type CallEvent, type CallSession } from '@/types';

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

/**
 * PATCH /api/telephony/calls/[id] — disposición y notas del cierre.
 *
 * Solo el agente de la llamada (o admin+) y solo con la llamada ya
 * terminada. Guardar la disposición marca `wrap_up_completed_at`, que
 * es lo que permite medir el tiempo de cierre en los reportes.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      disposition?: unknown;
      notes?: unknown;
    };

    if (body.disposition !== undefined && body.disposition !== null) {
      if (!isCallDisposition(body.disposition)) {
        return NextResponse.json(
          { error: 'Disposición inválida.' },
          { status: 400 }
        );
      }
    }

    let notes: string | null | undefined;
    if (body.notes !== undefined) {
      if (body.notes !== null && typeof body.notes !== 'string') {
        return NextResponse.json(
          { error: 'Las notas deben ser texto.' },
          { status: 400 }
        );
      }
      notes =
        typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : null;
    }

    const { data, error } = await ctx.supabase
      .from('call_sessions')
      .select('*')
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

    const call = data as CallSession;
    const isAdmin = ctx.role === 'owner' || ctx.role === 'admin';
    if (call.agent_user_id !== ctx.userId && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isTerminalCallStatus(call.status)) {
      return NextResponse.json(
        { error: 'La llamada sigue en curso; cierra primero.' },
        { status: 400 }
      );
    }

    const patch: Record<string, unknown> = {};
    if (body.disposition !== undefined) {
      patch.disposition = body.disposition;
      if (body.disposition) {
        patch.wrap_up_completed_at =
          call.wrap_up_completed_at ?? new Date().toISOString();
      }
    }
    if (notes !== undefined) patch.notes = notes;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ call });
    }

    const { data: updated, error: updateError } = await ctx.supabase
      .from('call_sessions')
      .update(patch)
      .eq('id', call.id)
      .select('*, contact:contacts(id, name, phone)')
      .single();
    if (updateError) throw updateError;

    if (body.disposition !== undefined) {
      await ctx.supabase.from('call_events').insert({
        account_id: ctx.accountId,
        call_id: call.id,
        type: 'disposition_set',
        actor_user_id: ctx.userId,
        payload: { disposition: body.disposition ?? null },
      });
    }

    return NextResponse.json({ call: updated as CallSession });
  } catch (err) {
    return toErrorResponse(err);
  }
}
