import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { OutboundCampaignContact } from '@/types';

/**
 * POST /api/telephony/campaigns/[id]/next — reclama el siguiente
 * contacto de una campaña activa (agente+).
 *
 * La reserva es atómica (`claim_campaign_contact`, migración 124):
 * dos agentes nunca reciben el mismo contacto. Si la campaña se quedó
 * sin pendientes, responde `{ contact: null }` y la campaña puede
 * haber quedado `completed`.
 *
 * El agente marca después con el flujo normal de llamadas, pasando
 * `campaignContactId` para que el cierre cuente el intento.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;

    const { data, error } = await ctx.supabase.rpc('claim_campaign_contact', {
      p_campaign_id: id,
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
      if (error.code === '42501') {
        return NextResponse.json(
          { error: 'No perteneces a este negocio.' },
          { status: 403 }
        );
      }
      if (error.code === 'P0001' || error.code === 'P0002') {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    const row = ((data ?? []) as OutboundCampaignContact[])[0];
    if (!row) {
      return NextResponse.json({ contact: null });
    }

    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id, name, phone')
      .eq('id', row.contact_id)
      .maybeSingle();

    return NextResponse.json({
      contact: {
        ...row,
        contact_name: (contact?.name as string | null) ?? null,
        contact_phone: (contact?.phone as string | null) ?? null,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
