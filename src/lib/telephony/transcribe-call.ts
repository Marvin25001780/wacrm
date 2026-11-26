// ============================================================
// Transcripción de una grabación de llamada, compartida por la
// ruta manual y el webhook de LiveKit.
//
// La ruta y el webhook tienen clientes de Supabase distintos (RLS
// del agente vs. service role), por eso la función recibe la
// conexión. Todo lo demás — descarga, proveedor, estados y evento —
// vive aquí para que ambos caminos se comporten igual.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/ai/admin-client';
import {
  loadTranscriptionConfig,
  transcribeAudio,
  transcriptionProvider,
} from '@/lib/ai/transcribe';
import { loadExternalIntegrations } from '@/lib/integrations/external';
import { pushCallToVoiceSummary } from '@/lib/integrations/voicesummary';
import type { CallSession } from '@/types';

const MAX_RECORDING_BYTES = 24 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

export interface TranscribeCallOutcome {
  call?: CallSession;
  error?: string;
  /** Código HTTP sugerido para la ruta manual. */
  status?: number;
}

function mimeFromFilename(filename: string): string {
  if (filename.endsWith('.mp3')) return 'audio/mpeg';
  if (filename.endsWith('.m4a')) return 'audio/mp4';
  if (filename.endsWith('.wav')) return 'audio/wav';
  if (filename.endsWith('.webm')) return 'audio/webm';
  return 'audio/ogg';
}

/**
 * Transcribe `call.recording_url` y guarda el texto en la sesión.
 *
 * Idempotente: una llamada ya transcrita se devuelve tal cual, y una
 * que está en curso (`processing`) no se vuelve a mandar al
 * proveedor. Los fallos quedan como `transcript_status='failed'` con
 * su evento, para que el agente pueda reintentar con el botón.
 */
export async function transcribeCallRecording(
  db: SupabaseClient,
  call: CallSession,
  options: {
    actorUserId?: string | null;
    /** `automatic` cuando lo dispara el webhook de Egress. */
    source?: 'manual' | 'automatic';
  } = {}
): Promise<TranscribeCallOutcome> {
  if (call.transcript_status === 'done' && call.transcript) {
    return { call };
  }
  if (call.transcript_status === 'processing') {
    return { call };
  }
  if (!call.recording_url) {
    return {
      error:
        'La llamada no tiene una grabación descargable. Revisa la configuración de Egress y TELEPHONY_RECORDINGS_PUBLIC_BASE_URL.',
      status: 400,
    };
  }

  const config = await loadTranscriptionConfig(db, call.account_id);
  const provider = config ? transcriptionProvider(config.provider) : null;
  if (!config || !provider) {
    return {
      error:
        'El negocio no tiene un proveedor de transcripción configurado (OpenAI, Groq o Gemini) en Ajustes → Asistente de IA.',
      status: 400,
    };
  }

  await db
    .from('call_sessions')
    .update({ transcript_status: 'processing' })
    .eq('id', call.id);

  let res: Response;
  try {
    res = await fetch(call.recording_url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    const message = 'No se pudo descargar la grabación (tiempo de espera agotado).';
    await markFailed(db, call, message);
    return { error: message, status: 502 };
  }

  if (!res.ok) {
    const message = `No se pudo descargar la grabación (${res.status}).`;
    await markFailed(db, call, message);
    return { error: message, status: 502 };
  }

  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_RECORDING_BYTES) {
    const message =
      'La grabación supera los 24 MB; recorta la llamada o usa un modelo con más límite.';
    await markFailed(db, call, message);
    return { error: message, status: 413 };
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_RECORDING_BYTES) {
    const message = 'La grabación está vacía o supera los 24 MB.';
    await markFailed(db, call, message);
    return { error: message, status: 400 };
  }

  const filename =
    call.recording_url.split('?')[0].split('/').pop() || `${call.id}.ogg`;
  const mimeType =
    res.headers.get('content-type')?.split(';')[0] || mimeFromFilename(filename);

  let transcript: string;
  try {
    transcript = await transcribeAudio({
      provider,
      apiKey: config.apiKey,
      model: config.model ?? undefined,
      buffer,
      mimeType,
      filename,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'No se pudo transcribir la llamada.';
    await markFailed(db, call, message);
    return { error: message, status: 502 };
  }

  if (!transcript.trim()) {
    const message = 'El proveedor devolvió una transcripción vacía.';
    await markFailed(db, call, message);
    return { error: message, status: 502 };
  }

  const { data: updated, error: updateError } = await db
    .from('call_sessions')
    .update({ transcript, transcript_status: 'done' })
    .eq('id', call.id)
    .select('*')
    .single();
  if (updateError) {
    await markFailed(db, call, 'No se pudo guardar la transcripción.');
    return { error: 'No se pudo guardar la transcripción.', status: 500 };
  }

  await db.from('call_events').insert({
    account_id: call.account_id,
    call_id: call.id,
    type: 'transcribed',
    actor_user_id: options.actorUserId ?? null,
    payload: {
      provider,
      chars: transcript.length,
      source: options.source ?? 'manual',
    },
  });

  // Best-effort: si la cuenta tiene VoiceSummary activo, la llamada
  // recién transcrita se empuja sin bloquear un error de la integración.
  await pushToVoiceSummary(updated as CallSession);

  return { call: updated as CallSession };
}

/**
 * Empuja la transcripción a VoiceSummary cuando la cuenta lo tiene
 * activo. Un fallo aquí no rompe la transcripción: se registra en el
 * servidor y el agente puede reintentar desde el diálogo de la llamada.
 */
async function pushToVoiceSummary(call: CallSession): Promise<void> {
  if (!call.transcript?.trim() || !call.recording_url) return;

  try {
    const admin = supabaseAdmin();
    const config = await loadExternalIntegrations(admin, call.account_id);
    if (!config?.voicesummary.enabled || !config.voicesummary.url) return;

    let contactName: string | null = null;
    if (call.contact_id) {
      const { data } = await admin
        .from('contacts')
        .select('name')
        .eq('id', call.contact_id)
        .maybeSingle<{ name: string | null }>();
      contactName = data?.name ?? null;
    }

    let agentName: string | null = null;
    if (call.agent_profile_id) {
      const { data } = await admin
        .from('profiles')
        .select('full_name')
        .eq('id', call.agent_profile_id)
        .maybeSingle<{ full_name: string | null }>();
      agentName = data?.full_name ?? null;
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
      console.warn('[transcribe-call] VoiceSummary no aceptó la llamada:', result.error);
      return;
    }

    await admin.from('call_events').insert({
      account_id: call.account_id,
      call_id: call.id,
      type: 'voicesummary_pushed',
      payload: { duplicate: result.duplicate ?? false },
    });
  } catch (error) {
    console.error('[transcribe-call] push a VoiceSummary falló:', error);
  }
}

async function markFailed(
  db: SupabaseClient,
  call: CallSession,
  message: string
) {
  await db
    .from('call_sessions')
    .update({ transcript_status: 'failed' })
    .eq('id', call.id);
  await db.from('call_events').insert({
    account_id: call.account_id,
    call_id: call.id,
    type: 'transcription_failed',
    payload: { message: message.slice(0, 500) },
  });
}
