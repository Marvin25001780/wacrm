import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * GET /api/telephony/campaigns/contacts — contactos del negocio
 * disponibles para armar una campaña saliente (admin+).
 *
 * Devuelve `id`, nombre, teléfono y `phone_normalized` para poder
 * marcar desde el softphone sin ambigüedades de formato.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const { supabase, accountId } = ctx;

    const { data, error } = await supabase
      .from('contacts')
      .select('id, name, phone, phone_normalized')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;

    const contacts = ((data ?? []) as Array<{
      id: string;
      name: string | null;
      phone: string | null;
      phone_normalized: string | null;
    }>).map((contact) => ({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      phone_normalized: contact.phone_normalized,
    }));

    return NextResponse.json({ contacts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
