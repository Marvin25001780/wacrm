import { describe, expect, it } from 'vitest';

import {
  aggregateCallbacks,
  aggregateCalls,
  CALLBACK_SLA_SECONDS,
  businessDayKey,
  businessHour,
  mergeQaScores,
  type ReportCallRow,
  type ReportCallbackRow,
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

  it('añade las notas de QA sin tocar el resto del reporte', () => {
    const withQa = mergeQaScores(report, [
      { agent_user_id: 'agent-a', score: 80 },
      { agent_user_id: 'agent-a', score: 100 },
      { agent_user_id: 'agent-b', score: 60 },
    ]);

    expect(withQa.totals.qaCount).toBe(3);
    expect(withQa.totals.avgQaScore).toBe(80);
    expect(withQa.totals.qaCoverage).toBe(1);
    expect(withQa.agents[0]).toMatchObject({
      user_id: 'agent-a',
      qaCount: 2,
      qaScore: 90,
    });
    expect(withQa.agents[1]).toMatchObject({
      user_id: 'agent-b',
      qaCount: 1,
      qaScore: 60,
    });
    // El resto de los agregados no cambia.
    expect(withQa.totals.total).toBe(report.totals.total);
    expect(withQa.daysSeries).toEqual(report.daysSeries);
  });

  it('sin evaluaciones deja la cobertura en cero y las notas en null', () => {
    const withQa = mergeQaScores(report, []);
    expect(withQa.totals.qaCount).toBe(0);
    expect(withQa.totals.avgQaScore).toBeNull();
    expect(withQa.totals.qaCoverage).toBe(0);
    expect(withQa.totals.aiQaCount).toBe(0);
    expect(withQa.totals.aiAvgQaScore).toBeNull();
    expect(withQa.agents.every((agent) => agent.qaScore === null)).toBe(true);
  });

  it('suma las evaluaciones automáticas con IA sin mezclar con la humana', () => {
    const withAi = mergeQaScores(report, [
      { agent_user_id: 'agent-a', score: 70, source: 'ai' },
      { agent_user_id: 'agent-a', score: 90, source: 'ai' },
      { agent_user_id: 'agent-b', score: 55, source: 'ai' },
    ]);

    expect(withAi.totals.aiQaCount).toBe(3);
    expect(withAi.totals.aiAvgQaScore).toBe(72);
    expect(withAi.totals.qaCount).toBe(0);
    expect(withAi.totals.avgQaScore).toBeNull();
    expect(withAi.agents[0]).toMatchObject({
      user_id: 'agent-a',
      qaCount: 0,
      qaScore: null,
      aiQaCount: 2,
      aiQaScore: 80,
    });
    expect(withAi.agents[1]).toMatchObject({
      user_id: 'agent-b',
      aiQaCount: 1,
      aiQaScore: 55,
    });
  });

  it('compara humana y automática en la misma fusión', () => {
    const withBoth = mergeQaScores(report, [
      { agent_user_id: 'agent-a', score: 90, source: 'human' },
      { agent_user_id: 'agent-a', score: 70, source: 'ai' },
      { agent_user_id: 'agent-b', score: 60, source: 'human' },
      { agent_user_id: 'agent-b', score: 55, source: 'ai' },
    ]);

    expect(withBoth.totals.qaCount).toBe(2);
    expect(withBoth.totals.aiQaCount).toBe(2);
    expect(withBoth.totals.aiAvgQaScore).toBe(63);
    expect(withBoth.agents[0]).toMatchObject({
      qaCount: 1,
      qaScore: 90,
      aiQaCount: 1,
      aiQaScore: 70,
    });
    expect(withBoth.agents[1]).toMatchObject({
      qaCount: 1,
      qaScore: 60,
      aiQaCount: 1,
      aiQaScore: 55,
    });
  });
});

const CALLBACK_NOW = new Date('2026-11-14T15:00:00Z').getTime();

const CALLBACK_ROWS: ReportCallbackRow[] = [
  {
    status: 'done',
    reason: 'missed',
    created_at: '2026-11-14T13:00:00Z',
    claimed_at: '2026-11-14T13:10:00Z',
    completed_at: '2026-11-14T13:40:00Z',
    completed_by: 'agent-a',
    assigned_user_id: 'agent-a',
    source_call_id: 'call-1',
  },
  {
    status: 'done',
    reason: 'timeout',
    created_at: '2026-11-14T14:00:00Z',
    claimed_at: '2026-11-14T14:40:00Z',
    completed_at: '2026-11-14T14:50:00Z',
    completed_by: 'agent-b',
    assigned_user_id: 'agent-b',
    source_call_id: 'call-2',
  },
  // Cerrada sin haberse reclamado (flujo antiguo): cuenta para la
  // resolución, pero no para la respuesta ni para el SLA.
  {
    status: 'done',
    reason: 'missed',
    created_at: '2026-11-14T12:00:00Z',
    claimed_at: null,
    completed_at: '2026-11-14T12:30:00Z',
    completed_by: 'agent-a',
    assigned_user_id: null,
    source_call_id: 'call-3',
  },
  {
    status: 'pending',
    reason: 'manual',
    created_at: '2026-11-14T12:00:00Z',
    claimed_at: null,
    completed_at: null,
    completed_by: null,
    assigned_user_id: null,
    source_call_id: null,
  },
  {
    status: 'in_progress',
    reason: 'declined',
    created_at: '2026-11-14T11:00:00Z',
    claimed_at: '2026-11-14T11:05:00Z',
    completed_at: null,
    completed_by: null,
    assigned_user_id: 'agent-a',
    source_call_id: 'call-4',
  },
  {
    status: 'cancelled',
    reason: 'missed',
    created_at: '2026-11-14T10:00:00Z',
    claimed_at: null,
    completed_at: null,
    completed_by: null,
    assigned_user_id: null,
    source_call_id: 'call-5',
  },
];

describe('aggregateCallbacks', () => {
  const report = aggregateCallbacks(CALLBACK_ROWS, {
    now: CALLBACK_NOW,
    roster: [
      ...ROSTER,
      { user_id: 'agent-c', name: 'Carla', role: 'agent' },
    ],
  });

  it('cuenta los estados y el origen de cada solicitud', () => {
    expect(report.total).toBe(6);
    expect(report.pending).toBe(1);
    expect(report.inProgress).toBe(1);
    expect(report.done).toBe(3);
    expect(report.cancelled).toBe(1);
    expect(report.manual).toBe(1);
    expect(report.fromMissed).toBe(5);
    expect(report.recoveryRate).toBe(0.5);
  });

  it('mide respuesta, resolución y la pendiente más vieja', () => {
    // Respuesta: 10, 40 y 5 minutos.
    expect(report.avgResponseSeconds).toBe(1100);
    // Resolución: 40, 50 y 30 minutos (la que nunca se reclamó incluida).
    expect(report.avgResolutionSeconds).toBe(2400);
    // La más antigua abierta se creó a las 11:00 con reloj a las 15:00.
    expect(report.oldestPendingSeconds).toBe(4 * 60 * 60);
  });

  it('evalúa el SLA de primera respuesta solo donde hubo reclamo', () => {
    expect(CALLBACK_SLA_SECONDS).toBe(1800);
    expect(report.slaTargetSeconds).toBe(1800);
    expect(report.slaEligible).toBe(3);
    // 10 min y 5 min cumplen; 40 min no.
    expect(report.slaMet).toBe(2);
    expect(report.slaCompliance).toBeCloseTo(2 / 3, 3);
  });

  it('reparte el trabajo por agente y deja al resto en cero', () => {
    expect(report.agents.map((agent) => agent.name)).toEqual([
      'Ana',
      'Beto',
      'Carla',
    ]);
    expect(report.agents[0]).toMatchObject({
      user_id: 'agent-a',
      claimed: 2,
      done: 2,
      avgResponseSeconds: 450,
      avgResolutionSeconds: 2100,
    });
    expect(report.agents[1]).toMatchObject({
      user_id: 'agent-b',
      claimed: 1,
      done: 1,
      avgResponseSeconds: 2400,
      avgResolutionSeconds: 3000,
    });
    expect(report.agents[2]).toMatchObject({
      user_id: 'agent-c',
      claimed: 0,
      done: 0,
      avgResponseSeconds: null,
    });
  });

  it('sin devoluciones no inventa cifras', () => {
    const empty = aggregateCallbacks([], { now: CALLBACK_NOW });
    expect(empty.total).toBe(0);
    expect(empty.recoveryRate).toBeNull();
    expect(empty.slaCompliance).toBeNull();
    expect(empty.avgResponseSeconds).toBeNull();
    expect(empty.avgResolutionSeconds).toBeNull();
    expect(empty.oldestPendingSeconds).toBeNull();
    expect(empty.agents).toEqual([]);
  });

  it('acepta un objetivo de SLA distinto sin tocar los datos', () => {
    const strict = aggregateCallbacks(CALLBACK_ROWS, {
      now: CALLBACK_NOW,
      slaTargetSeconds: 300,
    });
    // Solo la de 5 minutos entra en un objetivo de 5 minutos.
    expect(strict.slaTargetSeconds).toBe(300);
    expect(strict.slaEligible).toBe(3);
    expect(strict.slaCompliance).toBeCloseTo(1 / 3, 3);
  });
});
