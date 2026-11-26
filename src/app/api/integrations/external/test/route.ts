import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadExternalIntegrations } from '@/lib/integrations/external';
import { testListmonk } from '@/lib/integrations/listmonk';
import { testVoiceSummary } from '@/lib/integrations/voicesummary';

export const runtime = 'nodejs';

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST /api/integrations/external/test  { kind }
 *
 * Prueba la conexión con la configuración guardada. No acepta URLs del
 * cuerpo: así una cuenta no puede usar el CRM para escanear la red
 * interna con credenciales distintas a las que ya guardó un admin.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => ({}))) as { kind?: unknown };
    const kind = typeof body.kind === 'string' ? body.kind : '';

    const config = await loadExternalIntegrations(ctx.supabase, ctx.accountId);
    if (!config) return bad('Falta aplicar la migración 132 (integraciones externas).', 409);

    if (kind === 'openreplay') {
      if (!config.openreplay.url) return bad('OpenReplay no tiene URL configurada.');
      try {
        const res = await fetch(config.openreplay.url, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(8_000),
          cache: 'no-store',
        });
        return NextResponse.json({
          ok: res.status < 500,
          status: res.status,
          detail:
            res.status < 500
              ? 'El servidor respondió. El tracker se probará al abrir el CRM.'
              : 'El servidor respondió con un error.',
        });
      } catch {
        return NextResponse.json({
          ok: false,
          error: 'No se pudo contactar al servidor de OpenReplay.',
        });
      }
    }

    if (kind === 'listmonk') {
      const { url, user, token } = config.listmonk;
      if (!url || !user || !token) {
        return bad('Listmonk no tiene URL, usuario o token configurados.');
      }
      const result = await testListmonk({ url, user, token });
      return NextResponse.json(result);
    }

    if (kind === 'voicesummary') {
      if (!config.voicesummary.url) return bad('VoiceSummary no tiene URL configurada.');
      const result = await testVoiceSummary({
        url: config.voicesummary.url,
        token: config.voicesummary.token,
      });
      return NextResponse.json(result);
    }

    return bad('Integración desconocida.');
  } catch (error) {
    return toErrorResponse(error);
  }
}
