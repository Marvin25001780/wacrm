import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * POST /api/cobranza/debtors/[id]/claim
 * Body: { action: 'claim' | 'release' }
 *
 * Reclamar es atómico en la base (125): si otro gestor ya tomó al
 * deudor, la función falla con su nombre en vez de pisarlo. Un admin
 * sí puede reasignárselo.
 *
 * Se hace por RPC y no con un UPDATE directo porque además hay que
 * mantener `collection_assignments` (una activa por deudor) y
 * resolver el `profiles.id` del llamante.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
    };

    if (body.action !== 'claim' && body.action !== 'release') {
      return NextResponse.json(
        { error: 'Acción inválida. Usa claim o release.' },
        { status: 400 }
      );
    }

    if (body.action === 'release') {
      const { data, error } = await ctx.supabase.rpc('collection_release_debtor', {
        p_debtor_id: id,
      });
      if (error) return rpcError(error);
      return NextResponse.json({ released: Boolean(data) });
    }

    const { data, error } = await ctx.supabase.rpc('collection_claim_debtor', {
      p_debtor_id: id,
    });
    if (error) return rpcError(error);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return NextResponse.json(
        { error: 'No se pudo tomar el deudor.' },
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
          'Falta aplicar la migración 125_collection_agent_desk.sql para tomar deudores.',
        migration: '125',
      },
      { status: 409 }
    );
  }
  // Los mensajes de la función son legibles a propósito ("Este deudor
  // ya lo tomó Ana"): se devuelven tal cual para mostrarlos en el toast.
  return NextResponse.json(
    { error: error.message ?? 'No se pudo actualizar la asignación.' },
    { status: 409 }
  );
}
