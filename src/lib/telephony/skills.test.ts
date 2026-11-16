import { describe, expect, it } from 'vitest';

import {
  agentCanTakeCall,
  formatSkillList,
  isSkillOverflowDue,
  MAX_SKILL_LENGTH,
  MAX_SKILLS,
  missingSkills,
  normalizeSkill,
  normalizeSkillList,
  normalizeSkillOverflowSeconds,
} from './skills';

describe('habilidades: normalización', () => {
  it('recorta, pasa a minúsculas y colapsa espacios', () => {
    expect(normalizeSkill('  Ventas   Telefónicas ')).toBe('ventas telefónicas');
    expect(normalizeSkill('SOPORTE')).toBe('soporte');
  });

  it('descarta vacías, no texto y demasiado largas', () => {
    expect(normalizeSkill('   ')).toBeNull();
    expect(normalizeSkill(42)).toBeNull();
    expect(normalizeSkill('x'.repeat(MAX_SKILL_LENGTH + 1))).toBeNull();
  });

  it('normaliza listas, quita duplicados y respeta el orden', () => {
    const result = normalizeSkillList(['Ventas', 'soporte', 'VENTAS']);
    expect(result.skills).toEqual(['ventas', 'soporte']);
    expect(result.rejected).toEqual([]);
    expect(result.overflow).toBe(0);
  });

  it('acepta una cadena separada por comas', () => {
    expect(normalizeSkillList(' ventas, soporte ,, cobranza ').skills).toEqual([
      'ventas',
      'soporte',
      'cobranza',
    ]);
  });

  it('reporta las entradas rechazadas y el excedente', () => {
    const nine = Array.from({ length: MAX_SKILLS + 1 }, (_, i) => `s${i}`);
    const result = normalizeSkillList([...nine, ' ']);
    expect(result.skills).toHaveLength(MAX_SKILLS);
    expect(result.overflow).toBe(1);
    expect(result.rejected).toEqual([]);
  });

  it('formatea la lista para la UI', () => {
    expect(formatSkillList(['ventas', 'soporte'])).toBe('ventas, soporte');
    expect(formatSkillList(null)).toBe('');
  });
});

describe('habilidades: elegibilidad de la llamada', () => {
  it('sin requisito entra cualquier agente', () => {
    expect(agentCanTakeCall({ required_skills: [] }, [])).toBe(true);
    expect(agentCanTakeCall({}, null)).toBe(true);
  });

  it('exige todas las habilidades, no solo una', () => {
    const call = { required_skills: ['ventas', 'cobranza'] };
    expect(agentCanTakeCall(call, ['ventas'])).toBe(false);
    expect(agentCanTakeCall(call, ['ventas', 'cobranza'])).toBe(true);
    expect(agentCanTakeCall(call, ['VENTAS', ' Cobranza '])).toBe(true);
  });

  it('con desbordamiento el requisito ya no aplica', () => {
    const call = {
      required_skills: ['ventas'],
      overflowed_at: '2026-01-01T10:01:00.000Z',
    };
    expect(agentCanTakeCall(call, [])).toBe(true);
    expect(missingSkills(call, [])).toEqual([]);
  });

  it('lista las habilidades que faltan', () => {
    expect(missingSkills({ required_skills: ['ventas', 'cobranza'] }, ['ventas'])).toEqual([
      'cobranza',
    ]);
  });
});

describe('habilidades: desbordamiento', () => {
  it('0 segundos desactiva el desbordamiento', () => {
    expect(
      isSkillOverflowDue({
        startedAt: '2026-01-01T10:00:00.000Z',
        overflowSeconds: 0,
        now: new Date('2026-01-01T11:00:00.000Z').getTime(),
      })
    ).toBe(false);
  });

  it('vence al alcanzar los segundos configurados', () => {
    const startedAt = '2026-01-01T10:00:00.000Z';
    expect(
      isSkillOverflowDue({
        startedAt,
        overflowSeconds: 30,
        now: new Date('2026-01-01T10:00:29.000Z').getTime(),
      })
    ).toBe(false);
    expect(
      isSkillOverflowDue({
        startedAt,
        overflowSeconds: 30,
        now: new Date('2026-01-01T10:00:30.000Z').getTime(),
      })
    ).toBe(true);
  });

  it('valida el rango de segundos', () => {
    expect(normalizeSkillOverflowSeconds(0)).toBe(0);
    expect(normalizeSkillOverflowSeconds('45')).toBe(45);
    expect(normalizeSkillOverflowSeconds(3600)).toBe(3600);
    expect(normalizeSkillOverflowSeconds(-1)).toBeNull();
    expect(normalizeSkillOverflowSeconds(3601)).toBeNull();
    expect(normalizeSkillOverflowSeconds('abc')).toBeNull();
    expect(normalizeSkillOverflowSeconds(null)).toBeNull();
  });
});
