import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * DELETE /api/telephony/campaigns/[id]
 *
 * Elimina una campaña y sus contactos (las llamadas ya hechas se
 * conservan en `call_sessions`).
 */
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
