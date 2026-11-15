import { describe, expect, it } from 'vitest';

import {
  isQueueExpired,
  queueDeadlineIso,
  queueWaitSeconds,
  QUEUE_MAX_WAIT_SECONDS,
} from './queue';

describe('cola: espera y expiración', () => {
  const startedAt = '2026-01-01T10:00:00.000Z';
  const startedMs = Date.parse(startedAt);

  it('sin límite (0) nunca expira', () => {
    expect(isQueueExpired({ startedAt, maxWaitSeconds: 0, now: startedMs + 99_000 })).toBe(
      false
    );
    expect(queueWaitSeconds({ startedAt, maxWaitSeconds: 0, now: startedMs + 99_000 })).toBe(
      0
    );
  });

  it('expira cuando la espera supera el máximo', () => {
    expect(
      isQueueExpired({
        startedAt,
        maxWaitSeconds: 60,
        now: startedMs + 60_000,
      })
    ).toBe(true);
    expect(
      isQueueExpired({
        startedAt,
        maxWaitSeconds: 60,
        now: startedMs + 59_999,
      })
    ).toBe(false);
  });

  it('computa la espera acumulada en segundos', () => {
    expect(
      queueWaitSeconds({
        startedAt,
        maxWaitSeconds: 120,
        now: startedMs + 45_000,
      })
    ).toBe(45);
    expect(queueWaitSeconds({ startedAt, maxWaitSeconds: 120, now: startedMs })).toBe(0);
  });

  it('devuelve deadline ISO o null según el límite', () => {
    expect(queueDeadlineIso(startedAt, 60)).toBe('2026-01-01T10:01:00.000Z');
    expect(queueDeadlineIso(startedAt, 0)).toBeNull();
  });

  it('usa un máximo por defecto de 60 segundos', () => {
    expect(QUEUE_MAX_WAIT_SECONDS).toBe(60);
  });
});
