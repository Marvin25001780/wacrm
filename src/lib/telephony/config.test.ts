import { describe, expect, it } from 'vitest';

import type { TelephonyConfig } from '@/types';
import {
  normalizeInboundNumbers,
  resolveTelephony,
  telephonyBlockReason,
  type LoadedTelephonyConfig,
} from './config';
import { telephonyEnv } from './env';

const readyEnv = telephonyEnv({
  LIVEKIT_URL: 'wss://lk.example.com',
  LIVEKIT_API_KEY: 'key',
  LIVEKIT_API_SECRET: 'secret',
  LIVEKIT_SIP_TRUNK_ID: 'ST_env',
  LIVEKIT_RECORDING_ENABLED: 'true',
  TELEPHONY_RECORDINGS_PUBLIC_BASE_URL: 'https://cdn.example.com',
});

function row(patch: Partial<TelephonyConfig> = {}): TelephonyConfig {
  return {
    id: 'cfg-1',
    account_id: 'acc-1',
    enabled: true,
    provider: 'livekit',
    outbound_caller_id: null,
    sip_outbound_trunk_id: null,
    inbound_numbers: [],
    recording_enabled: false,
    transcription_enabled: true,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

function loaded(
  patch: Partial<TelephonyConfig> | null,
  migrationMissing = false
): LoadedTelephonyConfig {
  return { row: patch ? row(patch) : null, migrationMissing };
}

describe('resolveTelephony', () => {
  it('sin fila usa la troncal del entorno y queda activo', () => {
    const resolved = resolveTelephony(loaded(null), readyEnv);
    expect(resolved.enabled).toBe(true);
    expect(resolved.trunkId).toBe('ST_env');
    expect(resolved.livekitReady).toBe(true);
    expect(resolved.dialReady).toBe(true);
    expect(resolved.recordingEnabled).toBe(false);
  });

  it('la fila puede sobrescribir troncal, caller ID y números entrantes', () => {
    const resolved = resolveTelephony(
      loaded({
        sip_outbound_trunk_id: 'ST_business',
        outbound_caller_id: '+584121234567',
        inbound_numbers: ['+582121234567'],
      }),
      readyEnv
    );
    expect(resolved.trunkId).toBe('ST_business');
    expect(resolved.callerId).toBe('+584121234567');
    expect(resolved.inboundNumbers).toEqual(['+582121234567']);
  });

  it('la grabación exige el interruptor del negocio Y del servidor', () => {
    expect(
      resolveTelephony(loaded({ recording_enabled: true }), readyEnv)
        .recordingEnabled
    ).toBe(true);
    expect(
      resolveTelephony(
        loaded({ recording_enabled: true }),
        telephonyEnv({
          LIVEKIT_URL: 'wss://lk.example.com',
          LIVEKIT_API_KEY: 'key',
          LIVEKIT_API_SECRET: 'secret',
        })
      ).recordingEnabled
    ).toBe(false);
  });
});

describe('telephonyBlockReason', () => {
  it('explica el primer bloqueo', () => {
    expect(
      telephonyBlockReason(resolveTelephony(loaded(null, true), readyEnv))
    ).toContain('112_telephony.sql');
    expect(
      telephonyBlockReason(resolveTelephony(loaded(null), telephonyEnv({})))
    ).toContain('LiveKit');
    expect(
      telephonyBlockReason(
        resolveTelephony(loaded({ enabled: false }), readyEnv)
      )
    ).toContain('desactivada');
    expect(
      telephonyBlockReason(
        resolveTelephony(
          loaded(null),
          telephonyEnv({
            LIVEKIT_URL: 'wss://lk.example.com',
            LIVEKIT_API_KEY: 'key',
            LIVEKIT_API_SECRET: 'secret',
          })
        )
      )
    ).toContain('troncal SIP');
    expect(
      telephonyBlockReason(resolveTelephony(loaded(null), readyEnv))
    ).toBeNull();
  });
});

describe('normalizeInboundNumbers', () => {
  it('normaliza, descarta inválidos y deduplica', () => {
    expect(
      normalizeInboundNumbers([
        '0412 123 4567',
        '+58 412 123 4567',
        '+582121234567',
        'no',
        123,
      ])
    ).toEqual(['+584121234567', '+582121234567']);
  });

  it('devuelve lista vacía para entradas que no son arreglo', () => {
    expect(normalizeInboundNumbers(undefined)).toEqual([]);
    expect(normalizeInboundNumbers('04121234567')).toEqual([]);
  });
});
