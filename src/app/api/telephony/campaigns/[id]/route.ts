import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * PATCH  /api/telephony/campaigns/[id] — pausar, reanudar, completar o
 *                                       ajustar intentos/nombre (admin+).
 * DELETE /api/telephony/campaigns/[id] — eliminar la campaña.
 *
 * Eliminar la campaña conserva las llamadas ya hechas en
 * `call_sessions` (el borrado en cascada solo toca la lista).
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo inválido.' }, { status: 400 });
    }

    const update: Record<string, unknown> = {};

    if (body.status !== undefined) {
      const status = body.status;
      if (status !== 'active' && status !== 'paused' && status !== 'completed') {
        return NextResponse.json(
          { error: 'Estado de campaña inválido.' },
          { status: 400 }
        );
      }
      update.status = status;
      update.completed_at =
        status === 'completed' ? new Date().toISOString() : null;
    }

    if (body.maxAttempts !== undefined) {
      const maxAttempts = Number(body.maxAttempts);
      if (
        !Number.isFinite(maxAttempts) ||
        Math.floor(maxAttempts) !== maxAttempts ||
        maxAttempts < 1 ||
        maxAttempts > 10
      ) {
        return NextResponse.json(
          {
            error:
              'Los intentos por contacto deben ser un entero entre 1 y 10.',
          },
          { status: 400 }
        );
      }
      update.max_attempts = maxAttempts;
    }

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return NextResponse.json(
          { error: 'El nombre no puede quedar vacío.' },
          { status: 400 }
        );
      }
      if (name.length > 120) {
        return NextResponse.json(
          { error: 'El nombre es demasiado largo (máx. 120 caracteres).' },
          { status: 400 }
        );
      }
      update.name = name;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No hay cambios que guardar.' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('outbound_campaigns')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'La campaña no existe en este negocio.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ campaign: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await context.params;

    const { error } = await ctx.supabase
      .from('outbound_campaigns')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
