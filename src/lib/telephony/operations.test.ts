import { describe, expect, it } from 'vitest';

import {
  LONG_BREAK_SECONDS,
  LONG_WRAP_UP_SECONDS,
  SLA_AT_RISK_RATIO,
  isLongStatus,
  longestWaitSeconds,
  queueSlaLabel,
  queueSlaState,
  queueWaitRealSeconds,
  secondsSince,
  transferSecondsLeft,
} from './operations';

describe('operación en vivo (124)', () => {
  it('calcula segundos transcurridos y devuelve null sin fecha válida', () => {
    const now = Date.parse('2026-01-05T12:00:00.000Z');
    expect(secondsSince('2026-01-05T11:59:30.000Z', now)).toBe(30);
    expect(secondsSince('2026-01-05T12:00:00.000Z', now)).toBe(0);
    // Reloj adelantado: nunca negativo.
    expect(secondsSince('2026-01-05T12:00:10.000Z', now)).toBe(0);
    expect(secondsSince(null, now)).toBeNull();
    expect(secondsSince('no-es-fecha', now)).toBeNull();
  });

  it('clasifica el SLA de la cola con el 80 % como aviso', () => {
    expect(SLA_AT_RISK_RATIO).toBe(0.8);
    const maxWaitSeconds = 60;
    expect(queueSlaState({ waitSeconds: 0, maxWaitSeconds })).toBe('ok');
    expect(queueSlaState({ waitSeconds: 47, maxWaitSeconds })).toBe('ok');
    expect(queueSlaState({ waitSeconds: 48, maxWaitSeconds })).toBe('at_risk');
    expect(queueSlaState({ waitSeconds: 59, maxWaitSeconds })).toBe('at_risk');
    expect(queueSlaState({ waitSeconds: 60, maxWaitSeconds })).toBe('expired');
    expect(queueSlaState({ waitSeconds: 600, maxWaitSeconds })).toBe('expired');
  });

  it('sin límite de espera no hay estado de SLA', () => {
    expect(queueSlaState({ waitSeconds: 999, maxWaitSeconds: 0 })).toBe('none');
    expect(queueSlaState({ waitSeconds: 999, maxWaitSeconds: -5 })).toBe('none');
    expect(queueSlaLabel('none')).toBe('Sin límite');
    expect(queueSlaLabel('ok')).toBe('En tiempo');
    expect(queueSlaLabel('at_risk')).toBe('Por vencer');
    expect(queueSlaLabel('expired')).toBe('Vencida');
  });

  it('mide la espera real aunque el negocio no tenga tope', () => {
    const startedAt = '2026-01-05T12:00:00.000Z';
    const now = Date.parse('2026-01-05T12:03:00.000Z');
    // Sin `queued_at` se cuenta desde el alta.
    expect(queueWaitRealSeconds({ startedAt, now })).toBe(180);
    // Con reencolado (123) se cuenta desde ese momento.
    expect(
      queueWaitRealSeconds({
        startedAt,
        queuedAt: '2026-01-05T12:02:00.000Z',
        now,
      })
    ).toBe(60);
  });

  it('detecta pausas y cierres largos', () => {
    expect(LONG_BREAK_SECONDS).toBe(1200);
    expect(LONG_WRAP_UP_SECONDS).toBe(300);
    expect(isLongStatus({ status: 'break', seconds: 1199 })).toBe(false);
    expect(isLongStatus({ status: 'break', seconds: 1200 })).toBe(true);
    expect(isLongStatus({ status: 'wrap_up', seconds: 300 })).toBe(true);
    expect(isLongStatus({ status: 'wrap_up', seconds: 299 })).toBe(false);
    // Disponible u ocupado no generan alerta por tiempo.
    expect(isLongStatus({ status: 'available', seconds: 9999 })).toBe(false);
    expect(isLongStatus({ status: 'busy', seconds: 9999 })).toBe(false);
    expect(isLongStatus({ status: 'break', seconds: null })).toBe(false);
  });

  it('calcula lo que le queda al timbre de una transferencia', () => {
    const transferAt = '2026-01-05T12:00:00.000Z';
    const at = (iso: string) => Date.parse(`2026-01-05T12:00:${iso}.000Z`);

    expect(transferSecondsLeft({ transferAt, timeoutSeconds: 25, now: at('00') })).toBe(25);
    expect(transferSecondsLeft({ transferAt, timeoutSeconds: 25, now: at('10') })).toBe(15);
    expect(transferSecondsLeft({ transferAt, timeoutSeconds: 25, now: at('25') })).toBe(0);
    expect(transferSecondsLeft({ transferAt, timeoutSeconds: 25, now: at('30') })).toBe(-5);

    // Sin valor guardado se usa el timbre por defecto (25 s).
    expect(
      transferSecondsLeft({ transferAt, timeoutSeconds: null, now: at('00') })
    ).toBe(25);
    expect(
      transferSecondsLeft({ transferAt: 'no-es-fecha', timeoutSeconds: 25 })
    ).toBeNull();
  });

  it('toma la espera más larga de la cola', () => {
    expect(longestWaitSeconds([12, 45, 3])).toBe(45);
    expect(longestWaitSeconds([])).toBe(0);
    expect(longestWaitSeconds(null)).toBe(0);
  });
});
