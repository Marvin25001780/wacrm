import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadExternalIntegrations } from '@/lib/integrations/external';
import { fetchListmonkLists } from '@/lib/integrations/listmonk';

export const runtime = 'nodejs';

/**
 * GET /api/integrations/external/listmonk/lists
 *
 * Listas disponibles para el selector de suscripción. Solo admin.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const config = await loadExternalIntegrations(ctx.supabase, ctx.accountId);
    if (!config) {
      return NextResponse.json(
        { error: 'Falta aplicar la migración 132 (integraciones externas).' },
        { status: 409 },
      );
    }

    const { url, user, token, enabled } = config.listmonk;
    if (!enabled || !url || !user || !token) {
      return NextResponse.json({ error: 'Listmonk no está configurado.' }, { status: 400 });
    }

    const result = await fetchListmonkLists({ url, user, token });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? 'No se pudieron leer las listas de Listmonk.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ lists: result.data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}
