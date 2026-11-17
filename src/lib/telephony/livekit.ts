// ============================================================
// Puente con LiveKit (Apache-2.0) — tokens, SIP y grabación.
//
// Solo se importa desde rutas de API (servidor). El navegador
// recibe un token de corta duración; el API secret nunca sale.
// ============================================================

import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  RoomServiceClient,
  SipClient,
} from 'livekit-server-sdk';

import { isLivekitReady, telephonyEnv, type TelephonyEnv } from './env';

export class TelephonyNotConfiguredError extends Error {
  readonly status = 503 as const;
  readonly missing: string[];
  constructor(missing: string[] = []) {
    super(
      'La telefonía no está configurada en el servidor. Faltan variables de entorno de LiveKit.'
    );
    this.name = 'TelephonyNotConfiguredError';
    this.missing = missing;
  }
}

export function requireLivekit(
  env: TelephonyEnv = telephonyEnv()
): TelephonyEnv {
  if (!isLivekitReady(env)) throw new TelephonyNotConfiguredError(env.missing);
  return env;
}

/** El SDK de servidor espera https://, no wss://. */
export function livekitHttpHost(url: string): string {
  return url.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
}

function host(env: TelephonyEnv): string {
  return livekitHttpHost(env.url!);
}

export interface AgentToken {
  token: string;
  url: string;
  room: string;
  identity: string;
  expiresInSeconds: number;
}

/**
 * Token para que el agente entre a la sala. `ttl` corto: si la
 * pestaña se queda abierta no sirve para siempre.
 */
export async function createAgentToken(args: {
  room: string;
  identity: string;
  name?: string | null;
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
}): Promise<AgentToken> {
  const env = requireLivekit();
  const ttl = args.ttlSeconds ?? 60 * 60 * 2; // 2 h: una jornada de llamadas

  const at = new AccessToken(env.apiKey!, env.apiSecret!, {
    identity: args.identity,
    name: args.name ?? undefined,
    ttl,
    metadata: args.metadata ? JSON.stringify(args.metadata) : undefined,
  });
  at.addGrant({
    roomJoin: true,
    room: args.room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return {
    token: await at.toJwt(),
    url: env.url!,
    room: args.room,
    identity: args.identity,
    expiresInSeconds: ttl,
  };
}

/** Marca a un número PSTN dentro de la sala del agente. */
export async function dialPstn(args: {
  trunkId: string;
  to: string;
  room: string;
  fromNumber?: string | null;
  participantName?: string | null;
  /** Timbre máximo en segundos. */
  ringingTimeoutSeconds?: number;
}): Promise<{ participantId: string; sipCallId?: string }> {
  const env = requireLivekit();
  const client = new SipClient(host(env), env.apiKey!, env.apiSecret!);
  const info = await client.createSipParticipant(
    args.trunkId,
    args.to,
    args.room,
    {
      participantIdentity: `sip-${args.room}`,
      participantName: args.participantName ?? args.to,
      fromNumber: args.fromNumber ?? undefined,
      playDialtone: true,
      ringingTimeout: args.ringingTimeoutSeconds ?? 45,
      // Devolvemos el control al instante: el navegador ya está en la
      // sala y escucha el tono. El estado "contestada" llega por los
      // atributos SIP del participante y por el webhook.
      waitUntilAnswered: false,
      krispEnabled: true,
    }
  );
  return {
    participantId: info.participantId,
    sipCallId: info.sipCallId,
  };
}

/**
 * Inicia la grabación de la sala (solo audio). Requiere que el
 * servidor de LiveKit tenga un destino de Egress configurado y que
 * `LIVEKIT_RECORDING_ENABLED=true`.
 */
export async function startCallRecording(args: {
  room: string;
  filepath: string;
}): Promise<string | null> {
  const env = requireLivekit();
  if (!env.recordingEnabled) return null;

  const client = new EgressClient(host(env), env.apiKey!, env.apiSecret!);
  const info = await client.startRoomCompositeEgress(
    args.room,
    {
      file: new EncodedFileOutput({
        fileType: EncodedFileType.OGG,
        filepath: args.filepath,
      }),
    },
    { audioOnly: true }
  );
  return info.egressId || null;
}

/** Detiene la grabación si sigue viva. Nunca lanza al colgar. */
export async function stopCallRecording(egressId: string): Promise<void> {
  const env = requireLivekit();
  const client = new EgressClient(host(env), env.apiKey!, env.apiSecret!);
  try {
    await client.stopEgress(egressId);
  } catch (err) {
    console.warn('[telephony] no se pudo detener la grabación:', err);
  }
}

/**
 * Saca a un agente de la sala sin cerrarla (transferencia interna,
 * migración 123). El cliente y el nuevo agente siguen dentro. Nunca
 * lanza: si LiveKit no responde, la sesión ya cambió de dueño en la
 * base y el agente sale igual al desconectar su navegador.
 */
export async function removeAgentFromRoom(args: {
  room: string;
  userId: string;
}): Promise<boolean> {
  const env = requireLivekit();
  const client = new RoomServiceClient(host(env), env.apiKey!, env.apiSecret!);
  try {
    await client.removeParticipant(args.room, `user-${args.userId}`);
    return true;
  } catch (err) {
    console.warn(
      '[telephony] no se pudo sacar al agente de la sala:',
      args.room,
      err
    );
    return false;
  }
}

/**
 * Cierra la sala de LiveKit de una llamada (timeout de cola,
 * colgado, etc.). LiveKit la elimina y el webhook recibe
 * `room_finished`; la sesión ya está terminal en ese momento, así que
 * el cierre por sala es idempotente. Nunca lanza: si LiveKit no
 * responde el barrido de la cola sigue con la actualización en base.
 */
export async function closeCallRoom(roomName: string): Promise<boolean> {
  const env = requireLivekit();
  const client = new RoomServiceClient(host(env), env.apiKey!, env.apiSecret!);
  try {
    await client.deleteRoom(roomName);
    return true;
  } catch (err) {
    console.warn('[telephony] no se pudo cerrar la sala:', roomName, err);
    return false;
  }
}
