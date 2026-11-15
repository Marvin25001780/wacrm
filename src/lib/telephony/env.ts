// ============================================================
// Entorno de telefonía — lectura y validación de variables.
//
// La telefonía se apoya en LiveKit (Apache-2.0): el navegador habla
// WebRTC con LiveKit y LiveKit habla SIP con la troncal del
// operador. Las credenciales viven SOLO en el servidor; nunca se
// envían al navegador ni se guardan en la base de datos.
//
// Si faltan variables, la UI muestra qué falta y no permite marcar.
// No hay "modo demo": sin LiveKit no se simula una llamada.
//
// Este módulo es puro (recibe el entorno como argumento) para poder
// probarlo sin tocar `process.env`.
// ============================================================

export interface TelephonyEnv {
  /** URL WebSocket de LiveKit, normalizada a ws:// o wss://. */
  url: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  /** Troncal saliente por defecto del despliegue. */
  sipTrunkId: string | null;
  /** Egress (grabación) habilitado en este despliegue. */
  recordingEnabled: boolean;
  /**
   * Base pública donde LiveKit deja las grabaciones (p. ej. un
   * bucket público de Supabase Storage). Sin ella se guarda la
   * ubicación cruda de Egress, pero no se puede transcribir.
   */
  recordingsPublicBaseUrl: string | null;
  /**
   * Espera máxima en cola (segundos). `0` = sin límite. Override del
   * despliegue; por negocio la columna `telephony_config`.
   */
  queueMaxWaitSeconds: number;
  /** Nombres legibles de lo que falta para poder marcar. */
  missing: string[];
}

type EnvLike = Record<string, string | undefined>;

/** Normaliza la URL de LiveKit: https→wss, http→ws, sin barra final. */
export function normalizeLivekitUrl(
  raw: string | null | undefined
): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url = value.replace(/\/+$/, '');
  if (url.startsWith('https://')) url = `wss://${url.slice('https://'.length)}`;
  else if (url.startsWith('http://'))
    url = `ws://${url.slice('http://'.length)}`;
  if (!/^wss?:\/\//i.test(url)) return null;
  return url;
}

/**
 * Lee el entorno de telefonía. `env` es inyectable en pruebas.
 */
export function telephonyEnv(env: EnvLike = process.env): TelephonyEnv {
  const url = normalizeLivekitUrl(env.LIVEKIT_URL);
  const apiKey = env.LIVEKIT_API_KEY?.trim() || null;
  const apiSecret = env.LIVEKIT_API_SECRET?.trim() || null;
  const sipTrunkId = env.LIVEKIT_SIP_TRUNK_ID?.trim() || null;

  const missing: string[] = [];
  if (!url) missing.push('LIVEKIT_URL');
  if (!apiKey) missing.push('LIVEKIT_API_KEY');
  if (!apiSecret) missing.push('LIVEKIT_API_SECRET');

  return {
    url,
    apiKey,
    apiSecret,
    sipTrunkId,
    recordingEnabled: env.LIVEKIT_RECORDING_ENABLED === 'true',
    recordingsPublicBaseUrl:
      env.TELEPHONY_RECORDINGS_PUBLIC_BASE_URL?.replace(/\/+$/, '') || null,
    queueMaxWaitSeconds: clampQueueMaxWait(
      Number(env.TELEPHONY_QUEUE_MAX_WAIT_SECONDS ?? 60)
    ),
    missing,
  };
}

/** Espera máxima en cola: 0 = sin límite, máximo 3600 segundos. */
export function clampQueueMaxWait(
  seconds: number | null | undefined
): number {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return 60;
  return Math.min(3600, Math.floor(value));
}

/** ¿Hay credenciales para abrir salas y emitir tokens? */
export function isLivekitReady(env: TelephonyEnv): boolean {
  return Boolean(env.url && env.apiKey && env.apiSecret);
}

/**
 * ¿Se puede marcar a la PSTN? Hace falta LiveKit y una troncal
 * saliente (global o configurada por negocio).
 */
export function canDialPstn(
  env: TelephonyEnv,
  accountTrunkId?: string | null
): boolean {
  return isLivekitReady(env) && Boolean(env.sipTrunkId || accountTrunkId);
}

/**
 * Convierte la ubicación que devuelve Egress en una URL descargable.
 * Egress puede devolver una URL https, una ruta s3:// o solo el
 * nombre del archivo. Solo devolvemos algo si es http(s).
 */
export function recordingUrlFromEgress(
  location: string | null | undefined,
  publicBaseUrl: string | null
): string | null {
  const value = location?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (publicBaseUrl) {
    return `${publicBaseUrl}/${value.replace(/^\/+/, '')}`;
  }
  return null;
}
