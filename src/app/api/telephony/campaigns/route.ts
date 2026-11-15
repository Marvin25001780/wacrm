import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  OutboundCampaign,
  OutboundCampaignContact,
  OutboundCampaignDetail,
} from '@/types';

const CAMPAIGN_LIMIT = 50;
const MAX_CONTACTS_PER_CAMPAIGN = 1000;

/**
 * GET /api/telephony/campaigns — campañas salientes del negocio
 * (solo admin+): cada una con sus contactos y su estado.
 *
 * GET /api/telephony/campaigns/[id] — detalle de una campaña.
 */

export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const { supabase, accountId } = ctx;

    const { data: campaigns, error } = await supabase
      .from('outbound_campaigns')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(CAMPAIGN_LIMIT);
    if (error) throw error;
    const list = (campaigns ?? []) as OutboundCampaign[];
    if (list.length === 0) {
      return NextResponse.json({ campaigns: [] });
    }

    const contactRows = await supabase
      .from('outbound_campaign_contacts')
      .select('*')
      .in('campaign_id', list.map((c) => c.id));
    if (contactRows.error) throw contactRows.error;
    const contactsByCampaign = new Map<string, OutboundCampaignContact[]>();
    for (const row of (contactRows.data ?? []) as OutboundCampaignContact[]) {
      const bucket = contactsByCampaign.get(row.campaign_id) ?? [];
      bucket.push(row);
      contactsByCampaign.set(row.campaign_id, bucket);
    }

    const enriched = await Promise.all(
      list.map(async (campaign) => ({
        ...campaign,
        contacts: contactsByCampaign.get(campaign.id) ?? [],
      }))
    );

    // El detalle puede traer la campaña sin contactos (recién creada).
    return NextResponse.json({ campaigns: enriched });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Cuerpo inválido.' },
        { status: 400 }
      );
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { error: 'El nombre de la campaña es obligatorio.' },
        { status: 400 }
      );
    }
    if (name.length > 120) {
      return NextResponse.json(
        { error: 'El nombre es demasiado largo (máx. 120 caracteres).' },
        { status: 400 }
      );
    }

    const contactIds = Array.isArray(body.contactIds)
      ? body.contactIds.filter(
          (id): id is string => typeof id === 'string' && id.length > 0
        )
      : [];
    if (contactIds.length === 0) {
      return NextResponse.json(
        { error: 'Selecciona al menos un contacto.' },
        { status: 400 }
      );
    }
    if (contactIds.length > MAX_CONTACTS_PER_CAMPAIGN) {
      return NextResponse.json(
        { error: `Máximo ${MAX_CONTACTS_PER_CAMPAIGN} contactos por campaña.` },
        { status: 400 }
      );
    }

    const db: SupabaseClient = ctx.supabase;
    const { data: owned, error: lookupError } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', ctx.accountId)
      .in('id', contactIds);
    if (lookupError) throw lookupError;
    const validIds = new Set(
      ((owned ?? []) as { id: string }[]).map((row) => row.id)
    );
    const unknown = contactIds.filter((id) => !validIds.has(id));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: 'Uno o más contactos no pertenecen a este negocio.' },
        { status: 400 }
      );
    }

    const { data: campaign, error: insertError } = await db
      .from('outbound_campaigns')
      .insert({ account_id: ctx.accountId, name, created_by: ctx.userId })
      .select('*')
      .single();
    if (insertError) throw insertError;
    const created = campaign as OutboundCampaign;

    const { error: linksError } = await db
      .from('outbound_campaign_contacts')
      .insert(
        contactIds.map((contact_id) => ({
          campaign_id: created.id,
          contact_id,
          status: 'pending',
        }))
      );
    if (linksError) {
      await db.from('outbound_campaigns').delete().eq('id', created.id);
      throw linksError;
    }

    const { data: contacts, error: contactsError } = await db
      .from('outbound_campaign_contacts')
      .select('*')
      .eq('campaign_id', created.id);
    if (contactsError) throw contactsError;

    const detail: OutboundCampaignDetail = {
      ...created,
      contacts: (contacts ?? []) as OutboundCampaignContact[],
    };
    return NextResponse.json({ campaign: detail }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
