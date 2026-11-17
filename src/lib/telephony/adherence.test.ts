import { describe, expect, it } from 'vitest';

import {
  BUSINESS_TZ_OFFSET_MINUTES,
  breakIntervals,
  computeAdherence,
  computeAdherenceReport,
  formatRatio,
  localDayStartMs,
  localWeekday,
  overlapMs,
  parseTimeToMinutes,
  pauseReasonLabel,
  shiftIntervals,
  statusIntervals,
} from './adherence';

const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;

/** Medianoche UTC de una fecha local de Venezuela (UTC-4). */
function localToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hours = 0,
  minutes = 0
): number {
  return (
    Date.UTC(year, monthIndex, day, hours, minutes) -
    BUSINESS_TZ_OFFSET_MINUTES * MS_MINUTE
  );
}

/** 2026-01-05 es lunes. */
const MONDAY = { year: 2026, monthIndex: 0, day: 5 };
const at = (dayOffset: number, hours: number, minutes = 0) =>
  localToUtc(
    MONDAY.year,
    MONDAY.monthIndex,
    MONDAY.day + dayOffset,
    hours,
    minutes
  );

describe('WEM: tiempo local de Venezuela', () => {
  it('calcula el inicio del día local', () => {
    // Lunes 08:00 local = 12:00 UTC; el día empieza a las 04:00 UTC.
    expect(localDayStartMs(at(0, 8))).toBe(at(0, 0));
  });

  it('devuelve el día de la semana local', () => {
    expect(localWeekday(at(0, 0))).toBe(1); // lunes
    expect(localWeekday(at(6, 23, 30))).toBe(0); // domingo
  });

  it('parsea horas HH:MM y HH:MM:SS', () => {
    expect(parseTimeToMinutes('08:30')).toBe(510);
    expect(parseTimeToMinutes('8:05:00')).toBe(485);
    expect(parseTimeToMinutes('24:00')).toBeNull();
    expect(parseTimeToMinutes('x')).toBeNull();
  });
});

describe('WEM: turnos', () => {
  const mondayShift = {
    user_id: 'u1',
    weekday: 1,
    start_time: '08:00',
    end_time: '17:00',
  };

  it('convierte un turno semanal en un intervalo con la ventana completa', () => {
    const intervals = shiftIntervals(
      [mondayShift],
      at(0, 0),
      at(1, 0)
    );
    expect(intervals).toHaveLength(1);
    expect(intervals[0].start).toBe(at(0, 8));
    expect(intervals[0].end).toBe(at(0, 17));
  });

  it('recorta el turno a la ventana consultada', () => {
    const intervals = shiftIntervals([mondayShift], at(0, 12), at(0, 18));
    expect(intervals).toHaveLength(1);
    expect(intervals[0].start).toBe(at(0, 12));
    expect(intervals[0].end).toBe(at(0, 17));
  });

  it('un turno nocturno cruza medianoche', () => {
    const intervals = shiftIntervals(
      [
        {
          user_id: 'u1',
          weekday: 1,
          start_time: '22:00',
          end_time: '06:00',
        },
      ],
      at(0, 0),
      at(1, 12)
    );
    expect(intervals).toHaveLength(1);
    expect(intervals[0].start).toBe(at(0, 22));
    expect(intervals[0].end).toBe(at(1, 6));
    expect(intervals[0].end - intervals[0].start).toBe(8 * MS_HOUR);
  });

  it('no inventa turnos fuera de la ventana', () => {
    expect(shiftIntervals([mondayShift], at(1, 0), at(2, 0))).toEqual([]);
  });
});

describe('WEM: intervalos de estado', () => {
  it('reconstruye los intervalos a partir de los cambios', () => {
    const intervals = statusIntervals(
      [
        { user_id: 'u1', status: 'available', changed_at: new Date(at(0, 8)).toISOString() },
        { user_id: 'u1', status: 'break', changed_at: new Date(at(0, 10)).toISOString() },
        { user_id: 'u1', status: 'available', changed_at: new Date(at(0, 10, 30)).toISOString() },
      ],
      at(0, 8),
      at(0, 17)
    );
    expect(intervals).toHaveLength(3);
    expect(intervals[0]).toMatchObject({ status: 'available' });
    expect(intervals[0].end - intervals[0].start).toBe(2 * MS_HOUR);
    expect(intervals[1].end - intervals[1].start).toBe(30 * MS_MINUTE);
    expect(intervals[2].end - intervals[2].start).toBe(6.5 * MS_HOUR);
  });

  it('ignora eventos posteriores a la ventana y recorta el primero', () => {
    const intervals = statusIntervals(
      [
        { user_id: 'u1', status: 'break', changed_at: new Date(at(0, 6)).toISOString() },
        { user_id: 'u1', status: 'available', changed_at: new Date(at(0, 9)).toISOString() },
        { user_id: 'u1', status: 'break', changed_at: new Date(at(0, 20)).toISOString() },
      ],
      at(0, 8),
      at(0, 17)
    );
    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toMatchObject({
      status: 'break',
      start: at(0, 8),
      end: at(0, 9),
    });
    expect(intervals[1]).toMatchObject({
      status: 'available',
      end: at(0, 17),
    });
  });

  it('sin eventos no hay intervalos (no inventa estado)', () => {
    expect(statusIntervals([], at(0, 8), at(0, 17))).toEqual([]);
  });
});

describe('WEM: adherencia y ocupación', () => {
  const shifts = [
    {
      user_id: 'u1',
      weekday: 1,
      start_time: '08:00',
      end_time: '16:00',
    },
  ];
  const events = [
    { user_id: 'u1', status: 'available' as const, changed_at: new Date(at(0, 8)).toISOString() },
    { user_id: 'u1', status: 'break' as const, changed_at: new Date(at(0, 12)).toISOString() },
    { user_id: 'u1', status: 'available' as const, changed_at: new Date(at(0, 13)).toISOString() },
  ];
  const calls = [
    {
      agent_user_id: 'u1',
      answered_at: new Date(at(0, 9)).toISOString(),
      ended_at: new Date(at(0, 10)).toISOString(),
    },
  ];

  it('mide trabajo dentro del turno, pausa y hablado', () => {
    const row = computeAdherence('u1', {
      windowStart: at(0, 0),
      windowEnd: at(0, 16),
      shifts,
      events,
      calls,
    });

    expect(row.scheduledSeconds).toBe(8 * 3600);
    expect(row.workSeconds).toBe(7 * 3600);
    expect(row.availableSeconds).toBe(7 * 3600);
    expect(row.breakSeconds).toBe(3600);
    expect(row.breakCount).toBe(1);
    expect(row.talkSeconds).toBe(3600);
    expect(row.adherence).toBeCloseTo(7 / 8, 5);
    expect(row.occupancy).toBeCloseTo(1 / 7, 5);
  });

  it('sin turno la adherencia es null pero la ocupación se calcula', () => {
    const row = computeAdherence('u1', {
      windowStart: at(0, 0),
      windowEnd: at(0, 16),
      shifts: [],
      events,
      calls,
    });
    expect(row.scheduledSeconds).toBe(0);
    expect(row.adherence).toBeNull();
    expect(row.occupancy).toBeCloseTo(1 / 7, 5);
  });

  it('no mezcla agentes', () => {
    const rows = computeAdherenceReport(['u1', 'u2'], {
      windowStart: at(0, 0),
      windowEnd: at(1, 0),
      shifts,
      events,
      calls,
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      user_id: 'u2',
      scheduledSeconds: 0,
      workSeconds: 0,
      talkSeconds: 0,
      adherence: null,
      occupancy: null,
    });
  });

  it('suma la intersección de intervalos', () => {
    expect(
      overlapMs(
        [{ start: 0, end: 100 }],
        [{ start: 50, end: 150 }]
      )
    ).toBe(50);
  });

  it('formatea el porcentaje', () => {
    expect(formatRatio(0.824)).toBe('82 %');
    expect(formatRatio(null)).toBe('—');
  });

  it('etiqueta los motivos de pausa', () => {
    expect(pauseReasonLabel('almuerzo')).toBe('Almuerzo');
    expect(pauseReasonLabel('otro')).toBe('Otro');
    expect(pauseReasonLabel(null)).toBe('Pausa');
  });
});

describe('WEM: pausas programadas', () => {
  const shiftWithBreak = {
    user_id: 'u1',
    weekday: 1,
    start_time: '08:00',
    end_time: '16:00',
    break_start: '12:00',
    break_end: '13:00',
  };

  it('convierte la pausa programada en un intervalo', () => {
    const intervals = breakIntervals([shiftWithBreak], at(0, 0), at(1, 0));
    expect(intervals).toHaveLength(1);
    expect(intervals[0].start).toBe(at(0, 12));
    expect(intervals[0].end).toBe(at(0, 13));
  });

  it('ignora turnos sin pausa programada', () => {
    expect(
      breakIntervals(
        [
          {
            user_id: 'u1',
            weekday: 1,
            start_time: '08:00',
            end_time: '16:00',
            break_start: null,
            break_end: null,
          },
        ],
        at(0, 0),
        at(1, 0)
      )
    ).toEqual([]);
  });

  it('mide la pausa tomada dentro de la ventana programada', () => {
    const row = computeAdherence('u1', {
      windowStart: at(0, 0),
      windowEnd: at(0, 16),
      shifts: [shiftWithBreak],
      events: [
        { user_id: 'u1', status: 'available', changed_at: new Date(at(0, 8)).toISOString() },
        { user_id: 'u1', status: 'break', changed_at: new Date(at(0, 12)).toISOString() },
        { user_id: 'u1', status: 'available', changed_at: new Date(at(0, 13)).toISOString() },
      ],
      calls: [],
    });

    expect(row.scheduledBreakSeconds).toBe(3600);
    expect(row.breakSeconds).toBe(3600);
    expect(row.breakInsideSeconds).toBe(3600);
    expect(row.breakOutsideSeconds).toBe(0);
    expect(row.breakAdherence).toBe(1);
  });

  it('marca la pausa tomada fuera de la ventana programada', () => {
    const row = computeAdherence('u1', {
      windowStart: at(0, 0),
      windowEnd: at(0, 16),
      shifts: [shiftWithBreak],
      events: [
        { user_id: 'u1', status: 'available', changed_at: new Date(at(0, 8)).toISOString() },
        { user_id: 'u1', status: 'break', changed_at: new Date(at(0, 10)).toISOString() },
        { user_id: 'u1', status: 'available', changed_at: new Date(at(0, 11)).toISOString() },
      ],
      calls: [],
    });

    expect(row.scheduledBreakSeconds).toBe(3600);
    expect(row.breakSeconds).toBe(3600);
    expect(row.breakInsideSeconds).toBe(0);
    expect(row.breakOutsideSeconds).toBe(3600);
    expect(row.breakAdherence).toBe(0);
  });

  it('sin pausa programada el cumplimiento es null', () => {
    const row = computeAdherence('u1', {
      windowStart: at(0, 0),
      windowEnd: at(0, 16),
      shifts: [
        {
          user_id: 'u1',
          weekday: 1,
          start_time: '08:00',
          end_time: '16:00',
        },
      ],
      events: [
        { user_id: 'u1', status: 'break', changed_at: new Date(at(0, 10)).toISOString() },
        { user_id: 'u1', status: 'available', changed_at: new Date(at(0, 11)).toISOString() },
      ],
      calls: [],
    });

    expect(row.scheduledBreakSeconds).toBe(0);
    expect(row.breakSeconds).toBe(3600);
    expect(row.breakAdherence).toBeNull();
  });

  it('recorta la pausa a la ventana consultada', () => {
    const row = computeAdherence('u1', {
      windowStart: at(0, 12, 30),
      windowEnd: at(0, 16),
      shifts: [shiftWithBreak],
      events: [],
      calls: [],
    });
    expect(row.scheduledBreakSeconds).toBe(30 * 60);
    expect(row.scheduledSeconds).toBe(3.5 * 3600);
  });
});
