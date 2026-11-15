import { describe, expect, it } from 'vitest';

import {
  computeEvaluationScore,
  normalizeCriteria,
  QA_CRITERIA,
  QA_MAX_PER_CRITERION,
  summarizeQa,
} from './qa';

function perfect(): Record<string, number> {
  return Object.fromEntries(
    QA_CRITERIA.map((criterion) => [criterion.key, QA_MAX_PER_CRITERION])
  );
}

describe('computeEvaluationScore', () => {
  it('da 100 con todo al máximo', () => {
    expect(computeEvaluationScore(perfect())).toBe(100);
  });

  it('da 0 sin notas', () => {
    expect(computeEvaluationScore({})).toBe(0);
  });

  it('calcula el porcentaje sobre el máximo', () => {
    const scores = { ...perfect(), listening: 0 };
    const expected = Math.round(
      ((QA_CRITERIA.length - 1) * QA_MAX_PER_CRITERION) /
        (QA_CRITERIA.length * QA_MAX_PER_CRITERION) *
        100
    );
    expect(computeEvaluationScore(scores)).toBe(expected);
  });

  it('recorta valores fuera de rango', () => {
    const scores = { ...perfect(), greeting: 99, closing: -5 };
    // 99 se acota a 5; -5 se acota a 0. Cuatro criterios perfectos de cinco.
    expect(computeEvaluationScore(scores)).toBe(80);
  });
});

describe('normalizeCriteria', () => {
  it('devuelve una fila por criterio con su etiqueta', () => {
    const rows = normalizeCriteria({ greeting: 4, unknown: 5 });
    expect(rows).toHaveLength(QA_CRITERIA.length);
    expect(rows[0]).toEqual({
      key: 'greeting',
      label: 'Saludo y presentación',
      score: 4,
      max: QA_MAX_PER_CRITERION,
    });
    expect(rows.some((row) => row.key === 'unknown')).toBe(false);
  });

  it('redondea y acota las notas', () => {
    const rows = normalizeCriteria({ listening: 4.6, resolution: -2 });
    const listening = rows.find((row) => row.key === 'listening');
    const resolution = rows.find((row) => row.key === 'resolution');
    expect(listening?.score).toBe(5);
    expect(resolution?.score).toBe(0);
  });
});

describe('summarizeQa', () => {
  it('promedia y calcula cobertura', () => {
    expect(summarizeQa([80, 90, 100], 6)).toEqual({
      count: 3,
      average: 90,
      coverage: 0.5,
    });
  });

  it('sin evaluaciones devuelve ceros', () => {
    expect(summarizeQa([], 4)).toEqual({
      count: 0,
      average: null,
      coverage: 0,
    });
  });

  it('ignora notas inválidas', () => {
    expect(summarizeQa([70, NaN, 120, -1], 2)).toEqual({
      count: 1,
      average: 70,
      coverage: 0.5,
    });
  });
});
