import { describe, expect, it } from 'vitest';

import {
  allowedDebtorStatuses,
  defaultPromiseDue,
  dueLabel,
  isQueueScope,
  normalizeQueueSearch,
  queueRankLabel,
  queueRankTone,
  renderScript,
  tramoForDays,
  validateActionInput,
  type ActionInput,
} from './desk';

const TODAY = '2026-11-19';

const OUTCOMES = [
  {
    code: 'contacted',
    level: 1 as const,
    parent_code: null,
    requires_amount: false,
    requires_date: false,
    requires_reason: false,
    active: true,
  },
  {
    code: 'no_contact',
    level: 1 as const,
    parent_code: null,
    requires_amount: false,
    requires_date: false,
    requires_reason: false,
    active: true,
  },
  {
    code: 'ptp',
    level: 2 as const,
    parent_code: 'contacted',
    requires_amount: true,
    requires_date: true,
    requires_reason: false,
    active: true,
  },
  {
    code: 'refusal',
    level: 2 as const,
    parent_code: 'contacted',
    requires_amount: false,
    requires_date: false,
    requires_reason: true,
    active: true,
  },
];

function input(patch: Partial<ActionInput> = {}): ActionInput {
  return {
    level1: 'contacted',
    level2: 'refusal',
    channel: 'call',
    notes: 'Dice que no puede pagar este mes',
    ...patch,
  };
}

describe('cola de cobranza (etiquetas)', () => {
  it('valida los ámbitos de la cola', () => {
    expect(isQueueScope('mine')).toBe(true);
    expect(isQueueScope('unassigned')).toBe(true);
    expect(isQueueScope('all')).toBe(true);
    expect(isQueueScope('otro')).toBe(false);
  });

  it('nombra los grupos por urgencia', () => {
    expect(queueRankLabel(0)).toBe('PTP vencida');
    expect(queueRankLabel(1)).toBe('PTP próxima');
    expect(queueRankLabel(2)).toBe('En mora');
    expect(queueRankLabel(3)).toBe('Al día');
    expect(queueRankLabel(9)).toBe('Sin clasificar');
    expect(queueRankTone(0)).toContain('red');
    expect(queueRankTone(3)).toContain('sky');
  });

  it('normaliza la búsqueda', () => {
    expect(normalizeQueueSearch('  Ana   María  ')).toBe('Ana María');
    expect(normalizeQueueSearch('x'.repeat(100))).toHaveLength(60);
  });
});

describe('validación de la gestión', () => {
  it('acepta una negativa con motivo', () => {
    expect(validateActionInput(input(), OUTCOMES, { today: TODAY })).toEqual([]);
  });

  it('exige tipificación y detalle', () => {
    expect(validateActionInput(input({ level1: '' }), OUTCOMES, { today: TODAY })).toContain(
      'Elige una tipificación de contacto.'
    );
    expect(
      validateActionInput(input({ level2: null }), OUTCOMES, { today: TODAY })
    ).toContain('Elige el detalle de la tipificación.');
  });

  it('rechaza un detalle que no es hijo del nivel 1', () => {
    const errors = validateActionInput(
      input({ level1: 'no_contact', level2: 'refusal', notes: 'x' }),
      OUTCOMES,
      { today: TODAY }
    );
    // `no_contact` no tiene hijos: cualquier nivel 2 sobra.
    expect(errors).toEqual([]);
    const errors2 = validateActionInput(
      input({ level1: 'contacted', level2: 'otro' }),
      OUTCOMES,
      { today: TODAY }
    );
    expect(errors2).toContain('Ese detalle no pertenece a la tipificación elegida.');
  });

  it('exige motivo en la negativa', () => {
    expect(
      validateActionInput(input({ notes: '   ' }), OUTCOMES, { today: TODAY })
    ).toContain('Escribe el motivo en las notas.');
  });

  it('exige monto, fecha y crédito en la promesa', () => {
    const errors = validateActionInput(
      input({ level2: 'ptp', notes: null }),
      OUTCOMES,
      { today: TODAY, credits: [{ id: 'c1', balance: 500 }] }
    );
    expect(errors).toContain('El monto es obligatorio y debe ser mayor que cero.');
    expect(errors).toContain('La fecha es obligatoria para esta tipificación.');
    expect(errors).toContain('Elige el crédito de la promesa de pago.');
  });

  it('aplica la política del tramo a la promesa', () => {
    const policy = {
      ptp_max_days: 7,
      min_down_payment_pct: 10,
      max_discount_pct: 0,
      max_attempts_per_day: 3,
      allowed_start: '09:00',
      allowed_end: '18:00',
    };

    const past = validateActionInput(
      input({ level2: 'ptp', amount: 200, dueDate: '2026-11-10', creditId: 'c1' }),
      OUTCOMES,
      { today: TODAY, policy, credits: [{ id: 'c1', balance: 500 }] }
    );
    expect(past).toContain('La fecha de la promesa no puede estar en el pasado.');

    const tooFar = validateActionInput(
      input({ level2: 'ptp', amount: 200, dueDate: '2026-12-30', creditId: 'c1' }),
      OUTCOMES,
      { today: TODAY, policy, credits: [{ id: 'c1', balance: 500 }] }
    );
    expect(tooFar.join(' ')).toContain('hasta 7 días');

    const tooSmall = validateActionInput(
      input({ level2: 'ptp', amount: 10, dueDate: '2026-11-22', creditId: 'c1' }),
      OUTCOMES,
      { today: TODAY, policy, credits: [{ id: 'c1', balance: 500 }] }
    );
    expect(tooSmall.join(' ')).toContain('abono mínimo');

    const ok = validateActionInput(
      input({ level2: 'ptp', amount: 200, dueDate: '2026-11-22', creditId: 'c1' }),
      OUTCOMES,
      { today: TODAY, policy, credits: [{ id: 'c1', balance: 500 }] }
    );
    expect(ok).toEqual([]);
  });

  it('no acepta un crédito de otro deudor', () => {
    const errors = validateActionInput(
      input({ level2: 'ptp', amount: 100, dueDate: '2026-11-22', creditId: 'ajeno' }),
      OUTCOMES,
      { today: TODAY, credits: [{ id: 'c1', balance: 500 }] }
    );
    expect(errors).toContain('El crédito elegido no pertenece a este deudor.');
  });

  it('limita el largo de las notas', () => {
    const errors = validateActionInput(
      input({ notes: 'x'.repeat(2100) }),
      OUTCOMES,
      { today: TODAY }
    );
    expect(errors.join(' ')).toContain('2000');
  });

  it('solo un admin puede marcar jurídico', () => {
    expect(allowedDebtorStatuses(false)).not.toContain('juridico');
    expect(allowedDebtorStatuses(true)).toContain('juridico');
    // `pagado` nunca se fija a mano.
    expect(allowedDebtorStatuses(true)).not.toContain('pagado');
  });
});

describe('guión y fechas', () => {
  it('sustituye variables conocidas', () => {
    expect(
      renderScript('Hola {{nombre}}, debe {{ saldo }} con {{mora}} días.', {
        nombre: 'Ana',
        saldo: 'USD 120,00',
        mora: 32,
      })
    ).toBe('Hola Ana, debe USD 120,00 con 32 días.');
  });

  it('deja el marcador desconocido a la vista', () => {
    expect(renderScript('Hola {{nombre}}, {{apellido}}', { nombre: 'Ana' })).toBe(
      'Hola Ana, {{apellido}}'
    );
    expect(renderScript(null, {})).toBe('');
  });

  it('etiqueta el vencimiento', () => {
    expect(dueLabel(null, TODAY)).toBe('Sin fecha');
    expect(dueLabel('2026-11-19', TODAY)).toBe('Vence hoy');
    expect(dueLabel('2026-11-20', TODAY)).toBe('Vence mañana');
    expect(dueLabel('2026-11-22', TODAY)).toBe('Vence en 3 d');
    expect(dueLabel('2026-11-16', TODAY)).toBe('Venció hace 3 d');
  });

  it('propone una fecha dentro de la política', () => {
    expect(defaultPromiseDue(TODAY, 7)).toBe('2026-11-26');
    expect(defaultPromiseDue(TODAY, 3)).toBe('2026-11-22');
    expect(defaultPromiseDue(TODAY, 0)).toBe(TODAY);
  });

  it('clasifica el tramo igual que la base', () => {
    expect(tramoForDays(0)).toBe('1_15');
    expect(tramoForDays(15)).toBe('1_15');
    expect(tramoForDays(16)).toBe('16_30');
    expect(tramoForDays(61)).toBe('61_90');
    expect(tramoForDays(120)).toBe('90_plus');
  });
});
