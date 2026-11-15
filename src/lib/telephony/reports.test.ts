import { describe, expect, it } from 'vitest';

import {
  aggregateCalls,
  businessDayKey,
  businessHour,
  type ReportCallRow,
} from './reports';

const NOW = new Date('2026-11-14T15:00:00Z').getTime();

const ROWS: ReportCallRow[] = [
  {
    direction: 'inbound',
    status: 'ended',
    started_at: '2026-11-14T13:00:00Z', // 09:00 Caracas
    answered_at: '2026-11-14T13:00:20Z',
    ended_at: '2026-11-14T13:02:20Z',
    duration_seconds: 120,
    agent_user_id: 'agent-a',
    disposition: 'sale',
    recording_url: 'https://example.com/a.ogg',
    transcript_status: 'done',
    wrap_up_completed_at: '2026-11-14T13:02:40Z',
  },
  {
    direction: 'inbound',
    status: 'missed',
    started_at: '2026-11-14T14:00:00Z', // 10:00 Caracas
    answered_at: null,
    ended_at: null,
    duration_seconds: null,
    agent_user_id: null,
    disposition: null,
  },
  {
    direction: 'inbound',
    status: 'cancelled',
    started_at: '2026-11-13T20:00:00Z', // 16:00 Caracas
    answered_at: null,
    ended_at: null,
    duration_seconds: null,
    agent_user_id: null,
    disposition: null,
  },
  {
    direction: 'outbound',
    status: 'ended',
    started_at: '2026-11-14T02:30:00Z', // 22:30 Caracas del 13
    answered_at: '2026-11-14T02:30:05Z',
    ended_at: '2026-11-14T02:31:05Z',
    duration_seconds: 60,
    agent_user_id: 'agent-b',
    disposition: 'follow_up',
  },
  {
    direction: 'outbound',
    status: 'failed',
    started_at: '2026-11-14T12:00:00Z', // 08:00 Caracas
    answered_at: null,
    ended_at: null,
    duration_seconds: null,
    agent_user_id: 'agent-b',
    disposition: null,
  },
];

const ROSTER = [
  { user_id: 'agent-a', name: 'Ana', role: 'agent' },
  { user_id: 'agent-b', name: 'Beto', role: 'admin' },
];

describe('businessDayKey / businessHour', () => {
  it('usa la zona del negocio, no UTC', () => {
    expect(businessDayKey('2026-11-14T02:30:00Z')).toBe('2026-11-13');
    expect(businessHour('2026-11-14T02:30:00Z')).toBe(22);
    expect(businessHour('2026-11-14T13:00:00Z')).toBe(9);
  });

  it('ignora fechas inválidas', () => {
    expect(businessDayKey('no-es-fecha')).toBe('');
  });
});

describe('aggregateCalls', () => {
  const report = aggregateCalls(ROWS, {
    days: 2,
    now: NOW,
    roster: ROSTER,
  });

  it('cuenta totales, tasas y promedios', () => {
    expect(report.totals.total).toBe(5);
    expect(report.totals.inbound).toBe(3);
    expect(report.totals.outbound).toBe(2);
    expect(report.totals.answered).toBe(2);
    expect(report.totals.answeredInbound).toBe(1);
    expect(report.totals.missed).toBe(1);
    expect(report.totals.failed).toBe(1);
    expect(report.totals.cancelled).toBe(1);
    expect(report.totals.talkSeconds).toBe(180);
    expect(report.totals.avgHandleSeconds).toBe(90);
    expect(report.totals.avgWaitSeconds).toBe(20);
    expect(report.totals.answerRate).toBeCloseTo(1 / 3, 3);
    expect(report.totals.abandonmentRate).toBeCloseTo(1 / 3, 3);
    expect(report.totals.recorded).toBe(1);
    expect(report.totals.transcribed).toBe(1);
    expect(report.totals.avgWrapUpSeconds).toBe(20);
  });

  it('reparte los días en hora de Caracas', () => {
    expect(report.daysSeries).toHaveLength(2);
    expect(report.daysSeries[0]).toMatchObject({
      date: '2026-11-13',
      total: 2,
      answered: 1,
      missed: 0,
      talkSeconds: 60,
    });
    expect(report.daysSeries[1]).toMatchObject({
      date: '2026-11-14',
      total: 3,
      answered: 1,
      missed: 1,
      talkSeconds: 120,
    });
  });

  it('agrupa por hora local', () => {
    const byHour = new Map(report.hours.map((h) => [h.hour, h]));
    expect(byHour.get(9)).toMatchObject({ total: 1, answered: 1 });
    expect(byHour.get(10)).toMatchObject({ total: 1, answered: 0 });
    expect(byHour.get(22)).toMatchObject({ total: 1, answered: 1 });
    expect(byHour.get(8)).toMatchObject({ total: 1, answered: 0 });
    expect(report.hours).toHaveLength(24);
  });

  it('incluye a todo el equipo y ordena por contestadas', () => {
    expect(report.agents.map((a) => a.name)).toEqual(['Ana', 'Beto']);
    expect(report.agents[0]).toMatchObject({
      user_id: 'agent-a',
      total: 1,
      answered: 1,
      talkSeconds: 120,
      avgHandleSeconds: 120,
    });
    expect(report.agents[1]).toMatchObject({
      user_id: 'agent-b',
      total: 2,
      answered: 1,
      talkSeconds: 60,
      avgHandleSeconds: 60,
    });
  });

  it('cuenta disposiciones', () => {
    expect(report.dispositions).toEqual([
      { disposition: 'sale', count: 1 },
      { disposition: 'follow_up', count: 1 },
    ]);
  });
});
