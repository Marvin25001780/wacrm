import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import {
  isMissingIntegrationsTable,
  loadExternalIntegrations,
} from '@/lib/integrations/external';
import { pushCallToVoiceSummary } from '@/lib/integrations/voicesummary';
import type { CallSession } from '@/types';

export const runtime = 'nodejs';

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST /api/integrations/external/voicesummary/push  { callId }
 *
 * Empuja manualmente una llamada transcrita a VoiceSummary. La
 * transcripción automática ya lo hace al terminar; este botón existe
 * para reintentar o para llamadas anteriores a la integración.
 *
 * La lectura de la llamada usa la sesión del agente (RLS); la config
 * de la integración, que solo ve un admin, se lee con service role
 * después de validar que la llamada pertenece a la cuenta.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => ({}))) as { callId?: unknown };
    const callId = typeof body.callId === 'string' ? body.callId.trim() : '';
    if (!callId) return bad('Falta la llamada a enviar.');

    const { data: call, error } = await ctx.supabase
      .from('call_sessions')
      .select('*')
      .eq('id', callId)
      .eq('account_id', ctx.accountId)
      .maybeSingle<CallSession>();

    if (error) throw error;
    if (!call) return bad('La llamada no existe en este negocio.', 404);
    if (!call.transcript?.trim()) {
      return bad('La llamada todavía no tiene transcripción. Transcríbela primero.', 409);
    }
    if (!call.recording_url) {
      return bad('La llamada no tiene grabación; VoiceSummary exige el audio.', 409);
    }

    const config = await loadExternalIntegrations(supabaseAdmin(), ctx.accountId);
    if (!config) return bad('Falta aplicar la migración 132 (integraciones externas).', 409);
    if (!config.voicesummary.enabled || !config.voicesummary.url) {
      return bad('VoiceSummary no está configurado o está desactivado.', 409);
    }

    let contactName: string | null = null;
    if (call.contact_id) {
      const { data: contact } = await ctx.supabase
        .from('contacts')
        .select('name')
        .eq('id', call.contact_id)
        .maybeSingle<{ name: string | null }>();
      contactName = contact?.name ?? null;
    }

    let agentName: string | null = null;
    if (call.agent_profile_id) {
      const { data: agent } = await ctx.supabase
        .from('profiles')
        .select('full_name')
        .eq('id', call.agent_profile_id)
        .maybeSingle<{ full_name: string | null }>();
      agentName = agent?.full_name ?? null;
    }

    const result = await pushCallToVoiceSummary(
      { url: config.voicesummary.url, token: config.voicesummary.token },
      {
        id: call.id,
        transcript: call.transcript,
        recordingUrl: call.recording_url,
        startedAt: call.started_at,
        contactName,
        direction: call.direction,
        agentName,
      },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? 'VoiceSummary rechazó la llamada.' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate ?? false,
      status: result.status,
    });
  } catch (error) {
    if (isMissingIntegrationsTable(error as { code?: string } | null)) {
      return bad('Falta aplicar la migración 132 (integraciones externas).', 409);
    }
    return toErrorResponse(error);
  }
}
