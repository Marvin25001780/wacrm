import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/cobranza/debtors/[id]/assign
 * Body: { userId: string | null }
 *
 * Solo admin/owner. `userId` es el `auth.uid()` del gestor destino;
 * `null` lo devuelve a la cola sin asignar. La RPC (126) resuelve el
 * `profiles.id`, cierra la asignación anterior e inserta la nueva en
 * una sola transacción.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      userId?: unknown;
    };

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Deudor inválido.' }, { status: 400 });
    }

    const userId =
      typeof body.userId === 'string' && body.userId.trim()
        ? body.userId.trim()
        : null;

    if (userId !== null && !UUID_RE.test(userId)) {
      return NextResponse.json(
        { error: 'Selecciona un gestor válido.' },
        { status: 400 }
      );
    }

    if (userId === null) {
      const { data, error } = await ctx.supabase.rpc(
        'collection_release_debtor',
        { p_debtor_id: id }
      );
      if (error) return rpcError(error);
      return NextResponse.json({ released: Boolean(data), assignedTo: null });
    }

    const { data, error } = await ctx.supabase.rpc('collection_assign_debtor', {
      p_debtor_id: id,
      p_user_id: userId,
    });
    if (error) return rpcError(error);

    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          debtor_id: string;
          assigned_to: string;
          agent_user_id: string;
          agent_name: string;
        }
      | undefined;

    if (!row) {
      return NextResponse.json(
        { error: 'No se pudo asignar el deudor.' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      debtorId: row.debtor_id,
      assignedTo: row.assigned_to,
      agentUserId: row.agent_user_id,
      agentName: row.agent_name,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function rpcError(error: { code?: string; message?: string }): NextResponse {
  if (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    error.code === 'PGRST205'
  ) {
    return NextResponse.json(
      {
        error:
          'Falta aplicar la migración 126_collection_supervision.sql para reasignar cartera.',
        migration: '126',
      },
      { status: 409 }
    );
  }
  // Los mensajes de la función son legibles a propósito.
  return NextResponse.json(
    { error: error.message ?? 'No se pudo actualizar la asignación.' },
    { status: 409 }
  );
}
