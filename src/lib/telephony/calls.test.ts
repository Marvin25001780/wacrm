import { describe, expect, it } from 'vitest';

import {
  CALL_ROOM_PREFIX,
  callDurationMinutes,
  callResultForStatus,
  callSubject,
  formatCallDuration,
  isTelephonyRoom,
  isTerminalCallStatus,
  newCallRoomName,
  normalizeHangupReason,
  resolveHangupStatus,
  talkDurationSeconds,
} from './calls';

describe('salas de llamada', () => {
  it('crea salas reconocibles y únicas', () => {
    const room = newCallRoomName(() => 'abc');
    expect(room).toBe(`${CALL_ROOM_PREFIX}abc`);
    expect(isTelephonyRoom(room)).toBe(true);
    expect(isTelephonyRoom('otra-sala')).toBe(false);
    expect(isTelephonyRoom(null)).toBe(false);
  });
});

describe('duración', () => {
  it('cuenta solo el tiempo hablado', () => {
    expect(
      talkDurationSeconds(
        '2026-01-01T10:00:00.000Z',
        '2026-01-01T10:02:30.000Z'
      )
    ).toBe(150);
    expect(talkDurationSeconds(null, '2026-01-01T10:00:00.000Z')).toBeNull();
    expect(
      talkDurationSeconds(
        '2026-01-01T10:02:00.000Z',
        '2026-01-01T10:00:00.000Z'
      )
    ).toBeNull();
  });

  it('formatea 0:07, 4:31 y 1:02:09', () => {
    expect(formatCallDuration(7)).toBe('0:07');
    expect(formatCallDuration(271)).toBe('4:31');
    expect(formatCallDuration(3729)).toBe('1:02:09');
    expect(formatCallDuration(null)).toBe('—');
    expect(formatCallDuration(-1)).toBe('—');
  });

  it('redondea a minutos enteros con mínimo 1', () => {
    expect(callDurationMinutes(null)).toBe(1);
    expect(callDurationMinutes(0)).toBe(1);
    expect(callDurationMinutes(1)).toBe(1);
    expect(callDurationMinutes(61)).toBe(2);
  });
});

describe('cierre de llamada', () => {
  it('marca fallida solo si el transporte falló', () => {
    expect(resolveHangupStatus({ answeredAt: null, reason: 'failed' })).toBe(
      'failed'
    );
    expect(resolveHangupStatus({ answeredAt: null })).toBe('missed');
    expect(resolveHangupStatus({ answeredAt: null, reason: 'declined' })).toBe(
      'cancelled'
    );
    expect(
      resolveHangupStatus({ answeredAt: '2026-01-01T10:00:00.000Z' })
    ).toBe('ended');
  });

  it('deriva el resultado de la actividad', () => {
    expect(callResultForStatus('ended', '2026-01-01T10:00:00.000Z')).toBe(
      'answered'
    );
    expect(callResultForStatus('failed', null)).toBe('failed');
    expect(callResultForStatus('missed', null)).toBe('no_answer');
  });

  it('reconoce estados terminales', () => {
    expect(isTerminalCallStatus('ended')).toBe(true);
    expect(isTerminalCallStatus('missed')).toBe(true);
    expect(isTerminalCallStatus('ringing')).toBe(false);
    expect(isTerminalCallStatus('active')).toBe(false);
  });

  it('normaliza el motivo de colgado', () => {
    expect(normalizeHangupReason('timeout')).toBe('timeout');
    expect(normalizeHangupReason('agent_left')).toBe('agent_left');
    expect(normalizeHangupReason('otro')).toBe('hangup');
    expect(normalizeHangupReason(undefined)).toBe('hangup');
  });
});

describe('asunto de la actividad', () => {
  it('usa el nombre del contacto y cae al número', () => {
    expect(
      callSubject({
        direction: 'inbound',
        number: '+584121234567',
        contactName: 'Ana',
      })
    ).toBe('Llamada entrante de Ana');
    expect(
      callSubject({ direction: 'outbound', number: '+584121234567' })
    ).toBe('Llamada saliente a +584121234567');
    expect(callSubject({ direction: 'outbound', number: null })).toBe(
      'Llamada saliente a número desconocido'
    );
  });
});
