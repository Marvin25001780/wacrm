import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import {
  isMissingIntegrationsTable,
  loadExternalIntegrations,
  publicOpenreplayConfig,
} from '@/lib/integrations/external';

export const runtime = 'nodejs';

/**
 * GET /api/integrations/external/openreplay
 *
 * Config pública del tracker para cualquier miembro autenticado. La
 * fila solo la puede leer un admin por RLS, así que se consulta con
 * service role **después** de validar la sesión y la cuenta. Nunca se
 * devuelven tokens de Listmonk ni de VoiceSummary.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const config = await loadExternalIntegrations(supabaseAdmin(), ctx.accountId);

    return NextResponse.json(publicOpenreplayConfig(config), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (isMissingIntegrationsTable(error as { code?: string } | null)) {
      return NextResponse.json({ enabled: false, url: null, projectKey: null });
    }
    return toErrorResponse(error);
  }
}
