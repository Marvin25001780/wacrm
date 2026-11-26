// ============================================================
// Adaptador de VoiceSummary (MIT) por API.
//
// VoiceSummary guarda transcripciones de llamadas y las analiza con
// IA. Recibe `POST /api/calls/` con `call_id`, `transcript` (dict) y
// `audio_file_url`. El CRM empuja la transcripción ya guardada, sin
// copiar el proyecto ni compartir la base de datos.
// ============================================================

export interface VoiceSummaryCredentials {
  url: string;
  token: string | null;
}

export interface VoiceSummaryCall {
  id: string;
  transcript: string;
  recordingUrl: string | null;
  startedAt: string;
  contactName?: string | null;
  direction?: 'inbound' | 'outbound' | string | null;
  agentName?: string | null;
}

export interface VoiceSummaryPayload {
  call_id: string;
  transcript: {
    /** VoiceSummary resume a partir de `turns` (role/content). */
    turns: Array<{ role: string; content: string }>;
    text: string;
    truncated?: boolean;
  };
  audio_file_url: string;
  call_context: string;
  timestamp: string;
}

export interface VoiceSummaryResult {
  ok: boolean;
  status?: number;
  duplicate?: boolean;
  error?: string;
}

const TIMEOUT_MS = 15_000;
/** VoiceSummary manda el texto a un LLM: no conviene un muro de 200k. */
const MAX_TRANSCRIPT_CHARS = 40_000;

export function voiceSummaryUrl(baseUrl: string, path = '/api/calls/'): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * Construye el cuerpo que espera VoiceSummary. Devuelve `null` cuando
 * la llamada no tiene transcripción o grabación: sin audio su API
 * rechaza la creación, así que no se inventa una URL.
 */
export function buildVoiceSummaryPayload(
  call: VoiceSummaryCall,
): VoiceSummaryPayload | null {
  const transcript = call.transcript?.trim();
  if (!transcript || !call.recordingUrl) return null;

  const truncated = transcript.length > MAX_TRANSCRIPT_CHARS;
  const text = truncated ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) : transcript;

  const who = call.contactName?.trim() || 'contacto sin nombre';
  const agent = call.agentName?.trim();
  const direction = call.direction === 'outbound' ? 'saliente' : 'entrante';

  return {
    call_id: call.id,
    transcript: {
      turns: [{ role: 'call', content: text }],
      text,
      ...(truncated ? { truncated: true } : {}),
    },
    audio_file_url: call.recordingUrl,
    call_context: `Llamada ${direction} con ${who}${agent ? `, atendida por ${agent}` : ''}.`,
    timestamp: call.startedAt,
  };
}

export async function pushCallToVoiceSummary(
  config: VoiceSummaryCredentials,
  call: VoiceSummaryCall,
): Promise<VoiceSummaryResult> {
  const payload = buildVoiceSummaryPayload(call);
  if (!payload) {
    return { ok: false, error: 'La llamada no tiene transcripción o grabación para enviar.' };
  }

  try {
    const res = await fetch(voiceSummaryUrl(config.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });

    if (res.status === 409) {
      // Ya se había enviado antes: la API no permite duplicar call_id.
      return { ok: true, status: 409, duplicate: true };
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { detail?: string; message?: string }
        | null;
      return {
        ok: false,
        status: res.status,
        error: body?.detail ?? body?.message ?? `VoiceSummary respondió ${res.status}`,
      };
    }

    return { ok: true, status: res.status };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'VoiceSummary tardó demasiado en responder.'
        : error instanceof Error
          ? error.message
          : 'No se pudo contactar a VoiceSummary.';
    return { ok: false, error: message };
  }
}

/** Comprueba que el servidor responde y que la ruta de llamadas existe. */
export async function testVoiceSummary(
  config: VoiceSummaryCredentials,
): Promise<VoiceSummaryResult> {
  try {
    const res = await fetch(voiceSummaryUrl(config.url), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });

    if (res.ok || res.status === 401 || res.status === 403) {
      // 401/403 confirman que la app está viva; el token se valida al
      // empujar una llamada real.
      return { ok: res.ok, status: res.status };
    }
    return { ok: false, status: res.status, error: `VoiceSummary respondió ${res.status}` };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'VoiceSummary tardó demasiado en responder.'
          : 'No se pudo contactar a VoiceSummary.',
    };
  }
}
