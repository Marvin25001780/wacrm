import { describe, expect, it } from 'vitest';

import {
  canDialPstn,
  isLivekitReady,
  normalizeLivekitUrl,
  recordingUrlFromEgress,
  telephonyEnv,
} from './env';

describe('normalizeLivekitUrl', () => {
  it('convierte https a wss y quita la barra final', () => {
    expect(normalizeLivekitUrl('https://lk.example.com/')).toBe(
      'wss://lk.example.com'
    );
    expect(normalizeLivekitUrl('http://localhost:7880')).toBe(
      'ws://localhost:7880'
    );
    expect(normalizeLivekitUrl('wss://lk.example.com')).toBe(
      'wss://lk.example.com'
    );
  });

  it('rechaza vacío o esquemas desconocidos', () => {
    expect(normalizeLivekitUrl('')).toBeNull();
    expect(normalizeLivekitUrl(undefined)).toBeNull();
    expect(normalizeLivekitUrl('ftp://lk.example.com')).toBeNull();
  });
});

describe('telephonyEnv', () => {
  it('lista lo que falta para poder marcar', () => {
    const env = telephonyEnv({});
    expect(env.missing).toEqual([
      'LIVEKIT_URL',
      'LIVEKIT_API_KEY',
      'LIVEKIT_API_SECRET',
    ]);
    expect(isLivekitReady(env)).toBe(false);
    expect(canDialPstn(env)).toBe(false);
  });

  it('lee credenciales, troncal, grabación y base de grabaciones', () => {
    const env = telephonyEnv({
      LIVEKIT_URL: 'https://lk.example.com/',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'secret',
      LIVEKIT_SIP_TRUNK_ID: 'ST_1',
      LIVEKIT_RECORDING_ENABLED: 'true',
      TELEPHONY_RECORDINGS_PUBLIC_BASE_URL: 'https://cdn.example.com/audio/',
    });
    expect(env.url).toBe('wss://lk.example.com');
    expect(env.missing).toEqual([]);
    expect(isLivekitReady(env)).toBe(true);
    expect(canDialPstn(env)).toBe(true);
    expect(canDialPstn(env, 'ST_2')).toBe(true);
    expect(env.recordingEnabled).toBe(true);
    expect(env.recordingsPublicBaseUrl).toBe('https://cdn.example.com/audio');
  });

  it('sin troncal no se puede marcar a la PSTN', () => {
    const env = telephonyEnv({
      LIVEKIT_URL: 'wss://lk.example.com',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'secret',
    });
    expect(isLivekitReady(env)).toBe(true);
    expect(canDialPstn(env)).toBe(false);
    expect(canDialPstn(env, 'ST_account')).toBe(true);
  });
});

describe('recordingUrlFromEgress', () => {
  it('deja pasar URLs http(s)', () => {
    expect(recordingUrlFromEgress('https://cdn.example.com/a.ogg', null)).toBe(
      'https://cdn.example.com/a.ogg'
    );
  });

  it('antepone la base pública a rutas relativas', () => {
    expect(
      recordingUrlFromEgress('/recordings/a.ogg', 'https://cdn.example.com')
    ).toBe('https://cdn.example.com/recordings/a.ogg');
  });

  it('devuelve null si no hay forma de descargarla', () => {
    expect(recordingUrlFromEgress('s3://bucket/a.ogg', null)).toBeNull();
    expect(recordingUrlFromEgress(null, 'https://cdn.example.com')).toBeNull();
  });
});
