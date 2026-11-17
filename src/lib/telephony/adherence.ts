// ============================================================
// WEM — adherencia al turno a partir de la bitácora de estados.
//
// Lógica pura (sin base de datos) para poder probarla:
//   * convertir turnos semanales en intervalos absolutos,
//   * reconstruir intervalos de estado desde los cambios,
//   * calcular adherencia y ocupación por agente.
//
// Zona horaria: America/Caracas, UTC-4 fijo (Venezuela no tiene
// horario de verano). Los turnos se guardan en hora local y aquí se
// convierten a milisegundos UTC.
//
// Definiciones (v1, documentadas en docs/telefonia-livekit.md):
//   - Programado:   turnos del agente dentro de la ventana.
//   - Conectado:    tiempo con cualquier estado de agente registrado.
//   - Trabajo:      Disponible + Ocupado + Cierre.
//   - Adherencia:   trabajo dentro del turno / programado.
//   - Ocupación:    tiempo hablado / tiempo de trabajo.
//   - Pausa prog.:  ventana de pausa del turno (migración 121).
//   - Cumple pausa: pausa real dentro de la ventana / programada.
// ============================================================

import type { AgentStatus } from '@/types';

/** Desfase de America/Caracas respecto a UTC, en minutos. */
export const BUSINESS_TZ_OFFSET_MINUTES = -240;

const MS_MINUTE = 60_000;
const MS_DAY = 24 * 60 * MS_MINUTE;

/** Estados que cuentan como trabajo para la adherencia. */
export const WORK_STATUSES: AgentStatus[] = ['available', 'busy', 'wrap_up'];

/**
 * Motivos de pausa (lista fija en el código, no configurable). Se
 * guardan tal cual en `agent_status_log.reason`.
 */
export const PAUSE_REASONS: { value: string; label: string }[] = [
  { value: 'almuerzo', label: 'Almuerzo' },
  { value: 'descanso', label: 'Descanso' },
  { value: 'capacitacion', label: 'Capacitación' },
  { value: 'reunion', label: 'Reunión' },
  { value: 'personal', label: 'Personal' },
  { value: 'tecnico', label: 'Falla técnica' },
  { value: 'otro', label: 'Otro' },
];

export function pauseReasonLabel(value?: string | null): string {
  if (!value) return 'Pausa';
  return PAUSE_REASONS.find((reason) => reason.value === value)?.label ?? value;
}

/** Día local (00:00 en Venezuela) que contiene `ms`, en ms UTC. */
export function localDayStartMs(ms: number): number {
  const local = new Date(ms + BUSINESS_TZ_OFFSET_MINUTES * MS_MINUTE);
  return (
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    BUSINESS_TZ_OFFSET_MINUTES * MS_MINUTE
  );
}

/** Día de la semana local: 0 = domingo … 6 = sábado. */
export function localWeekday(ms: number): number {
  return new Date(ms + BUSINESS_TZ_OFFSET_MINUTES * MS_MINUTE).getUTCDay();
}

/** `08:30` / `08:30:00` → minutos desde medianoche (null si inválido). */
export function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 60 + minutes;
}

export interface ShiftRow {
  user_id: string;
  /** 0 = domingo … 6 = sábado (hora local). */
  weekday: number;
  /** `HH:MM` o `HH:MM:SS`. */
  start_time: string;
  end_time: string;
  /** Ventana de pausa planificada (migración 121), opcional. */
  break_start?: string | null;
  break_end?: string | null;
}

export interface TimeInterval {
  start: number;
  end: number;
}

export interface ShiftInterval extends TimeInterval {
  user_id: string;
}

interface WeeklyFields {
  startField: 'start_time' | 'break_start';
  endField: 'end_time' | 'break_end';
}

/**
 * Convierte filas semanales (turno o pausa) en intervalos absolutos
 * dentro de la ventana. Una ventana que termina antes de empezar cruza
 * medianoche y se cuenta en el día en que empieza.
 */
function weeklyIntervals(
  shifts: ShiftRow[],
  windowStart: number,
  windowEnd: number,
  fields: WeeklyFields
): ShiftInterval[] {
  if (windowEnd <= windowStart) return [];

  const intervals: ShiftInterval[] = [];
  // Un día antes y uno después: cubre turnos nocturnos que empiezan
  // fuera de la ventana y terminan dentro (y viceversa).
  const firstDay = localDayStartMs(windowStart) - MS_DAY;
  const lastDay = localDayStartMs(windowEnd) + MS_DAY;

  for (let day = firstDay; day <= lastDay; day += MS_DAY) {
    const weekday = localWeekday(day);
    for (const shift of shifts) {
      if (shift.weekday !== weekday) continue;
      const rawStart = shift[fields.startField];
      const rawEnd = shift[fields.endField];
      if (!rawStart || !rawEnd) continue;
      const startMinutes = parseTimeToMinutes(rawStart);
      const endMinutes = parseTimeToMinutes(rawEnd);
      if (startMinutes === null || endMinutes === null) continue;
      if (startMinutes === endMinutes) continue;

      const start = day + startMinutes * MS_MINUTE;
      let end = day + endMinutes * MS_MINUTE;
      if (end <= start) end += MS_DAY; // cruza medianoche

      const clippedStart = Math.max(start, windowStart);
      const clippedEnd = Math.min(end, windowEnd);
      if (clippedEnd > clippedStart) {
        intervals.push({
          user_id: shift.user_id,
          start: clippedStart,
          end: clippedEnd,
        });
      }
    }
  }

  return intervals.sort((a, b) => a.start - b.start);
}

/** Intervalos de los turnos planificados. */
export function shiftIntervals(
  shifts: ShiftRow[],
  windowStart: number,
  windowEnd: number
): ShiftInterval[] {
  return weeklyIntervals(shifts, windowStart, windowEnd, {
    startField: 'start_time',
    endField: 'end_time',
  });
}

/** Intervalos de las pausas programadas (migración 121). */
export function breakIntervals(
  shifts: ShiftRow[],
  windowStart: number,
  windowEnd: number
): ShiftInterval[] {
  return weeklyIntervals(shifts, windowStart, windowEnd, {
    startField: 'break_start',
    endField: 'break_end',
  });
}

export interface StatusEventRow {
  user_id: string;
  status: AgentStatus;
  changed_at: string;
}

export interface StatusInterval extends TimeInterval {
  user_id: string;
  status: AgentStatus;
}

/**
 * Reconstruye los intervalos de estado de un agente dentro de la
 * ventana. Sin un evento anterior al inicio, el estado previo se
 * desconoce y no se inventa: el primer intervalo empieza en su primer
 * cambio.
 */
export function statusIntervals(
  events: StatusEventRow[],
  windowStart: number,
  windowEnd: number
): StatusInterval[] {
  const sorted = [...events]
    .map((event) => ({
      user_id: event.user_id,
      status: event.status,
      at: new Date(event.changed_at).getTime(),
    }))
    .filter((event) => Number.isFinite(event.at))
    .sort((a, b) => a.at - b.at);

  const intervals: StatusInterval[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const start = Math.max(current.at, windowStart);
    const end = Math.min(next ? next.at : windowEnd, windowEnd);
    if (end > start) {
      intervals.push({
        user_id: current.user_id,
        status: current.status,
        start,
        end,
      });
    }
  }
  return intervals;
}

/** Suma de la intersección entre dos conjuntos de intervalos. */
export function overlapMs(a: TimeInterval[], b: TimeInterval[]): number {
  let total = 0;
  for (const left of a) {
    for (const right of b) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (end > start) total += end - start;
    }
  }
  return total;
}

export interface CallIntervalRow {
  agent_user_id: string | null;
  answered_at: string | null;
  ended_at: string | null;
}

export interface AdherenceInput {
  windowStart: number;
  windowEnd: number;
  shifts: ShiftRow[];
  events: StatusEventRow[];
  calls: CallIntervalRow[];
}

export interface AdherenceRow {
  user_id: string;
  scheduledSeconds: number;
  /** Conectado: cualquier estado registrado. */
  loggedSeconds: number;
  /** Disponible + Ocupado + Cierre dentro de la ventana. */
  workSeconds: number;
  /** Disponible dentro de la ventana. */
  availableSeconds: number;
  /** Pausa dentro de la ventana. */
  breakSeconds: number;
  /** Pausa programada dentro de la ventana (migración 121). */
  scheduledBreakSeconds: number;
  /** Pausa real que cayó dentro de la ventana programada. */
  breakInsideSeconds: number;
  /** Pausa real fuera de la ventana programada. */
  breakOutsideSeconds: number;
  /** Pausas contadas (intervalos de `break`). */
  breakCount: number;
  talkSeconds: number;
  /** Trabajo dentro del turno / programado (0–1). */
  adherence: number | null;
  /** Pausa dentro de la ventana programada / programada (0–1). */
  breakAdherence: number | null;
  /** Hablado / trabajo (0–1). */
  occupancy: number | null;
}

const seconds = (ms: number): number => Math.max(0, Math.round(ms / 1000));
const ratio = (part: number, total: number): number | null =>
  total > 0 ? Math.min(1, part / total) : null;

/**
 * Calcula la adherencia de UN agente. `shifts`, `events` y `calls`
 * pueden venir ya filtrados por usuario o mezclados: se filtran aquí.
 */
export function computeAdherence(
  userId: string,
  input: AdherenceInput
): AdherenceRow {
  const { windowStart, windowEnd } = input;

  const agentShifts = input.shifts.filter((shift) => shift.user_id === userId);
  const shifts = shiftIntervals(agentShifts, windowStart, windowEnd);
  const scheduledBreaks = breakIntervals(agentShifts, windowStart, windowEnd);
  const statuses = statusIntervals(
    input.events.filter((event) => event.user_id === userId),
    windowStart,
    windowEnd
  );

  const work = statuses.filter((row) => WORK_STATUSES.includes(row.status));
  const available = statuses.filter((row) => row.status === 'available');
  const pauses = statuses.filter((row) => row.status === 'break');

  const talk: TimeInterval[] = input.calls.flatMap((call) => {
    if (call.agent_user_id !== userId) return [];
    if (!call.answered_at) return [];
    const start = new Date(call.answered_at).getTime();
    const end = call.ended_at
      ? new Date(call.ended_at).getTime()
      : Math.min(windowEnd, start);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [];
    }
    return [{ start: Math.max(start, windowStart), end: Math.min(end, windowEnd) }];
  });

  const scheduledMs = shifts.reduce((sum, row) => sum + (row.end - row.start), 0);
  const workMs = work.reduce((sum, row) => sum + (row.end - row.start), 0);
  const availableMs = available.reduce(
    (sum, row) => sum + (row.end - row.start),
    0
  );
  const breakMs = pauses.reduce((sum, row) => sum + (row.end - row.start), 0);
  const scheduledBreakMs = scheduledBreaks.reduce(
    (sum, row) => sum + (row.end - row.start),
    0
  );
  const breakInsideMs = overlapMs(pauses, scheduledBreaks);
  const breakOutsideMs = Math.max(0, breakMs - breakInsideMs);
  const talkMs = overlapMs(talk, [{ start: windowStart, end: windowEnd }]);
  const workInShiftMs = overlapMs(work, shifts);

  return {
    user_id: userId,
    scheduledSeconds: seconds(scheduledMs),
    loggedSeconds: seconds(
      statuses.reduce((sum, row) => sum + (row.end - row.start), 0)
    ),
    workSeconds: seconds(workMs),
    availableSeconds: seconds(availableMs),
    breakSeconds: seconds(breakMs),
    scheduledBreakSeconds: seconds(scheduledBreakMs),
    breakInsideSeconds: seconds(breakInsideMs),
    breakOutsideSeconds: seconds(breakOutsideMs),
    breakCount: pauses.length,
    talkSeconds: seconds(talkMs),
    adherence: ratio(workInShiftMs, scheduledMs),
    breakAdherence: ratio(breakInsideMs, scheduledBreakMs),
    occupancy: ratio(talkMs, workMs),
  };
}

/** Adherencia de todo el equipo en una sola pasada. */
export function computeAdherenceReport(
  userIds: string[],
  input: AdherenceInput
): AdherenceRow[] {
  return userIds.map((userId) => computeAdherence(userId, input));
}

/** Porcentaje legible: `82 %` o `—`. */
export function formatRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)} %`;
}
