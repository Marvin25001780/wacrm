import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PER_AGENT,
  MAX_PER_AGENT,
  agentStatusLabel,
  clampPerAgent,
  daysLeftLabel,
  filterPromisesByAgent,
  normalizeDays,
  summarizeBoard,
} from './supervision';
import type {
  CollectionSupervisorPromise,
  CollectionSupervisorRow,
} from '@/types/collections';

function row(patch: Partial<CollectionSupervisorRow> = {}): CollectionSupervisorRow {
  return {
    user_id: 'u1',
    profile_id: 'p1',
    name: 'Ana',
    role: 'agent',
    assigned_count: 0,
    balance_assigned: 0,
    overdue_assigned: 0,
    actions_today: 0,
    contacts_today: 0,
    ptp_today: 0,
    promises_due_today: 0,
    promises_overdue: 0,
    broken_promises_30d: 0,
    last_action_at: null,
    ...patch,
  };
}

function promise(patch: Partial<CollectionSupervisorPromise> = {}): CollectionSupervisorPromise {
  return {
    promise_id: 'pr1',
    debtor_id: 'd1',
    debtor_name: 'Deudor',
    document_number: 'V-12345678',
    phone_primary: '+584121234567',
    agent_user_id: 'u1',
    agent_name: 'Ana',
    amount: 100,
    due_date: '2026-11-19',
    status: 'pending',
    days_left: 0,
    credit_folio: 'CR-1',
    ...patch,
  };
}

describe('supervisión de cobranza (reparto)', () => {
  it('acota el reparto por gestor entre 1 y 50', () => {
    expect(clampPerAgent(10)).toBe(10);
    expect(clampPerAgent('15')).toBe(15);
    expect(clampPerAgent(0)).toBe(1);
    expect(clampPerAgent(-4)).toBe(1);
    expect(clampPerAgent(999)).toBe(MAX_PER_AGENT);
    expect(clampPerAgent('abc')).toBe(DEFAULT_PER_AGENT);
    expect(clampPerAgent(null)).toBe(DEFAULT_PER_AGENT);
  });

  it('normaliza la ventana de promesas a 0..60 días', () => {
    expect(normalizeDays(undefined)).toBe(7);
    expect(normalizeDays('14')).toBe(14);
    expect(normalizeDays(-2)).toBe(0);
    expect(normalizeDays(99)).toBe(60);
    expect(normalizeDays('x')).toBe(7);
  });
});

describe('supervisión de cobranza (etiquetas)', () => {
  it('explica el vencimiento sin inventar fechas', () => {
    expect(daysLeftLabel(-3)).toBe('Vencida hace 3 d');
    expect(daysLeftLabel(-1)).toBe('Venció ayer');
    expect(daysLeftLabel(0)).toBe('Vence hoy');
    expect(daysLeftLabel(1)).toBe('Vence mañana');
    expect(daysLeftLabel(4)).toBe('Vence en 4 d');
  });

  it('traduce el estado del softphone', () => {
    expect(agentStatusLabel('available')).toBe('Disponible');
    expect(agentStatusLabel('busy')).toBe('En llamada');
    expect(agentStatusLabel('wrap_up')).toBe('After-call');
    expect(agentStatusLabel('break')).toBe('En pausa');
    expect(agentStatusLabel(null)).toBe('Sin señal');
  });
});

describe('supervisión de cobranza (resumen)', () => {
  it('suma el turno aunque la base devuelva números como texto', () => {
    const summary = summarizeBoard([
      row({
        assigned_count: 8,
        actions_today: '12' as unknown as number,
        contacts_today: 6,
        ptp_today: 3,
        promises_due_today: 2,
        promises_overdue: 1,
        broken_promises_30d: 4,
      }),
      row({
        user_id: 'u2',
        assigned_count: 5,
        actions_today: 8,
        contacts_today: 2,
        ptp_today: 1,
        promises_due_today: 1,
        promises_overdue: 0,
        broken_promises_30d: 0,
      }),
    ]);

    expect(summary.agents).toBe(2);
    expect(summary.assigned).toBe(13);
    expect(summary.actionsToday).toBe(20);
    expect(summary.contactsToday).toBe(8);
    expect(summary.ptpToday).toBe(4);
    expect(summary.dueToday).toBe(3);
    expect(summary.overdue).toBe(1);
    expect(summary.broken30d).toBe(4);
    expect(summary.contactRate).toBe(40);
  });

  it('no divide por cero cuando no hubo gestiones', () => {
    const summary = summarizeBoard([row()]);
    expect(summary.contactRate).toBe(0);
    expect(summary.actionsToday).toBe(0);
  });

  it('filtra las promesas del gestor elegido', () => {
    const rows = [
      promise(),
      promise({ promise_id: 'pr2', agent_user_id: 'u2', agent_name: 'Luis' }),
      promise({ promise_id: 'pr3', agent_user_id: null, agent_name: null }),
    ];

    expect(filterPromisesByAgent(rows, null)).toHaveLength(3);
    expect(filterPromisesByAgent(rows, 'u2').map((item) => item.promise_id)).toEqual([
      'pr2',
    ]);
    expect(filterPromisesByAgent(rows, 'u9')).toHaveLength(0);
  });
});
