import { describe, expect, it } from 'vitest';

import {
  compareQueueOrder,
  isQueueExpired,
  normalizeQueuePriority,
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

  it('mide la espera desde el reencolado si la llamada volvió a la cola', () => {
    // Llegó a las 10:00 y volvió a la cola a las 10:10 (123).
    const queuedAt = '2026-01-01T10:10:00.000Z';
    const queuedMs = Date.parse(queuedAt);
    // A las 10:11 solo lleva 1 minuto esperando, aunque el alta sea de 10:00.
    expect(
      queueWaitSeconds({
        startedAt,
        queuedAt,
        maxWaitSeconds: 120,
        now: queuedMs + 60_000,
      })
    ).toBe(60);
    expect(
      isQueueExpired({
        startedAt,
        queuedAt,
        maxWaitSeconds: 120,
        now: queuedMs + 60_000,
      })
    ).toBe(false);
    expect(
      isQueueExpired({
        startedAt,
        queuedAt,
        maxWaitSeconds: 120,
        now: queuedMs + 121_000,
      })
    ).toBe(true);
  });
});

describe('cola: prioridad y orden', () => {
  const entry = (priority: number, startedAt: string) => ({
    priority,
    started_at: startedAt,
  });

  it('normaliza la prioridad dentro de 0..5', () => {
    expect(normalizeQueuePriority(0)).toBe(0);
    expect(normalizeQueuePriority(3)).toBe(3);
    expect(normalizeQueuePriority(5)).toBe(5);
    expect(normalizeQueuePriority(-1)).toBe(0);
    expect(normalizeQueuePriority(9)).toBe(5);
    expect(normalizeQueuePriority(null)).toBe(0);
    expect(normalizeQueuePriority('x')).toBe(0);
  });

  it('ordena por prioridad descendente y FIFO dentro de la misma', () => {
    const older = entry(2, '2026-01-01T10:00:00.000Z');
    const newer = entry(2, '2026-01-01T10:05:00.000Z');
    const urgent = entry(5, '2026-01-01T11:00:00.000Z');
    expect(compareQueueOrder(older, newer) <= 0).toBe(true);
    expect(compareQueueOrder(older, urgent) > 0).toBe(true);
    expect(compareQueueOrder(urgent, older) < 0).toBe(true);
  });

  it('respeta el desempate FIFO con la misma prioridad', () => {
    const a = entry(1, '2026-01-01T09:00:00.000Z');
    const b = entry(1, '2026-01-01T08:00:00.000Z');
    expect(compareQueueOrder(a, b) > 0).toBe(true);
  });
});
