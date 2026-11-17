import { describe, expect, it } from 'vitest';

import {
  canTransferCall,
  isTransferExpired,
  isTransferPending,
  normalizeMaxTransfers,
  normalizeTransferRingTimeout,
  transferDeadline,
  transferTargetBlockReason,
} from './transfers';

describe('transferencias internas (123)', () => {
  it('normaliza el timbre de transferencia entre 5 y 300 segundos', () => {
    expect(normalizeTransferRingTimeout(25)).toBe(25);
    expect(normalizeTransferRingTimeout('30')).toBe(30);
    expect(normalizeTransferRingTimeout(5)).toBe(5);
    expect(normalizeTransferRingTimeout(300)).toBe(300);
    expect(normalizeTransferRingTimeout(4)).toBeNull();
    expect(normalizeTransferRingTimeout(301)).toBeNull();
    expect(normalizeTransferRingTimeout('abc')).toBeNull();
    expect(normalizeTransferRingTimeout(null)).toBeNull();
  });

  it('normaliza el máximo de transferencias (0 = sin límite)', () => {
    expect(normalizeMaxTransfers(0)).toBe(0);
    expect(normalizeMaxTransfers(3)).toBe(3);
    expect(normalizeMaxTransfers(10)).toBe(10);
    expect(normalizeMaxTransfers(11)).toBeNull();
    expect(normalizeMaxTransfers(-1)).toBeNull();
  });

  it('solo permite transferir una llamada activa', () => {
    expect(
      canTransferCall({ status: 'ringing', transferCount: 0, maxTransfers: 3 })
    ).toEqual({
      ok: false,
      reason: 'Solo se puede transferir una llamada en curso.',
    });
    expect(
      canTransferCall({ status: 'active', transferCount: 0, maxTransfers: 3 })
    ).toEqual({ ok: true });
  });

  it('respeta el tope de transferencias por llamada', () => {
    expect(
      canTransferCall({ status: 'active', transferCount: 2, maxTransfers: 3 })
        .ok
    ).toBe(true);
    expect(
      canTransferCall({ status: 'active', transferCount: 3, maxTransfers: 3 })
        .ok
    ).toBe(false);
    // 0 = sin límite.
    expect(
      canTransferCall({ status: 'active', transferCount: 99, maxTransfers: 0 })
        .ok
    ).toBe(true);
  });

  it('reconoce una transferencia pendiente', () => {
    expect(
      isTransferPending({
        status: 'ringing',
        transfer_at: '2026-01-05T12:00:00.000Z',
      })
    ).toBe(true);
    expect(
      isTransferPending({ status: 'ringing', transfer_at: null })
    ).toBe(false);
    expect(
      isTransferPending({
        status: 'active',
        transfer_at: '2026-01-05T12:00:00.000Z',
      })
    ).toBe(false);
  });

  it('calcula el vencimiento del timbre con el valor de la llamada', () => {
    const base = {
      status: 'ringing' as const,
      transfer_at: '2026-01-05T12:00:00.000Z',
      transfer_timeout_seconds: 30,
    };
    expect(transferDeadline(base)).toBe(
      Date.parse('2026-01-05T12:00:30.000Z')
    );
    expect(
      isTransferExpired(base, Date.parse('2026-01-05T12:00:29.000Z'))
    ).toBe(false);
    expect(
      isTransferExpired(base, Date.parse('2026-01-05T12:00:30.000Z'))
    ).toBe(true);

    // Sin valor guardado se usa el timbre por defecto (25 s).
    const legacy = { ...base, transfer_timeout_seconds: null };
    expect(transferDeadline(legacy)).toBe(
      Date.parse('2026-01-05T12:00:25.000Z')
    );
    expect(transferDeadline({ status: 'active', transfer_at: null, transfer_timeout_seconds: null })).toBeNull();
  });

  it('explica por qué un agente no puede recibir la transferencia', () => {
    const base = {
      userId: 'b',
      callerUserId: 'a',
      role: 'agent',
      agentStatus: 'available',
      hasLiveCall: false,
    };
    expect(transferTargetBlockReason(base)).toBeNull();
    expect(
      transferTargetBlockReason({ ...base, userId: 'a' })
    ).toContain('ti mismo');
    expect(
      transferTargetBlockReason({ ...base, role: 'viewer' })
    ).toContain('no atiende');
    expect(
      transferTargetBlockReason({ ...base, agentStatus: 'break' })
    ).toContain('no está disponible');
    expect(
      transferTargetBlockReason({ ...base, hasLiveCall: true })
    ).toContain('ya tiene una llamada');
  });
});
