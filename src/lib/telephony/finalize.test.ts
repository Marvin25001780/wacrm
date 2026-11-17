import { describe, expect, it } from 'vitest';

import { callbackReasonFor, shouldCreateCallbackForCall } from './finalize';

describe('devoluciones de llamada (122)', () => {
  const base = {
    direction: 'inbound' as const,
    answeredAt: null,
    status: 'missed' as const,
    phone: '+584121234567',
  };

  it('crea devolución para una entrante perdida', () => {
    expect(shouldCreateCallbackForCall(base)).toBe(true);
  });

  it('crea devolución cuando el agente rechazó la entrante', () => {
    expect(
      shouldCreateCallbackForCall({ ...base, status: 'cancelled', phone: '+584121234567' })
    ).toBe(true);
  });

  it('no crea devolución si la llamada se contestó', () => {
    expect(
      shouldCreateCallbackForCall({
        ...base,
        answeredAt: '2026-01-05T12:00:00.000Z',
        status: 'ended',
      })
    ).toBe(false);
  });

  it('no crea devolución para salientes ni fallos de transporte', () => {
    expect(shouldCreateCallbackForCall({ ...base, direction: 'outbound' })).toBe(
      false
    );
    expect(
      shouldCreateCallbackForCall({ ...base, status: 'failed' })
    ).toBe(false);
  });

  it('no crea devolución sin número', () => {
    expect(shouldCreateCallbackForCall({ ...base, phone: null })).toBe(false);
  });

  it('traduce el motivo del cierre al de la devolución', () => {
    expect(callbackReasonFor('timeout')).toBe('timeout');
    expect(callbackReasonFor('declined')).toBe('declined');
    expect(callbackReasonFor('hangup')).toBe('missed');
    expect(callbackReasonFor('agent_left')).toBe('missed');
    expect(callbackReasonFor(undefined)).toBe('missed');
  });
});
