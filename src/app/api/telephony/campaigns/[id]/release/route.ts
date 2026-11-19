import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * POST /api/telephony/campaigns/[id]/release — suelta una reserva que
 * no llegó a marcar (por ejemplo, la telefonía todavía no estaba
 * lista o el navegador canceló antes de crear la llamada).
 *
 * Solo libera reservas propias y sin llamada asociada: si la llamada
 * ya existe, el contacto se cierra por `record_campaign_attempt`
 * cuando la llamada termina.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      contactId?: unknown;
    };
    const contactId =
      typeof body.contactId === 'string' ? body.contactId : null;
    if (!contactId) {
      return NextResponse.json(
        { error: 'Falta el contacto a liberar.' },
        { status: 400 }
      );
    }

    const { data: row, error: lookupError } = await ctx.supabase
      .from('outbound_campaign_contacts')
      .select('id')
      .eq('id', contactId)
      .eq('campaign_id', id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!row) {
      return NextResponse.json(
        { error: 'El contacto no pertenece a esta campaña.' },
        { status: 404 }
      );
    }

    const { data, error } = await ctx.supabase.rpc('release_campaign_contact', {
      p_contact_id: contactId,
    });
    if (error) {
      if (error.code === '42883') {
        return NextResponse.json(
          {
            error:
              'Falta aplicar la migración 124_campaign_progressive.sql (siguiente contacto).',
          },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: data === true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
