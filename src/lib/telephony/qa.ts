// ============================================================
// Calidad de llamadas (QA / WEM).
//
// Rúbrica fija de cinco criterios, cada uno de 0 a 5. El puntaje de
// la evaluación es el porcentaje sobre el máximo posible, para que
// sea comparable entre versiones de la rúbrica y fácil de leer
// (0–100).
//
// Sin I/O: la usan la API y los reportes, y se prueba con valores.
// ============================================================

export interface QaCriterion {
  key: string;
  label: string;
  /** Descripción corta para el evaluador. */
  hint: string;
}

export const QA_CRITERIA: QaCriterion[] = [
  {
    key: 'greeting',
    label: 'Saludo y presentación',
    hint: 'Se presenta con su nombre y el del negocio.',
  },
  {
    key: 'identification',
    label: 'Identificación y verificación',
    hint: 'Confirma con quién habla y los datos necesarios.',
  },
  {
    key: 'listening',
    label: 'Escucha y empatía',
    hint: 'Deja hablar, no interrumpe y reconoce la necesidad.',
  },
  {
    key: 'resolution',
    label: 'Resolución y claridad',
    hint: 'Explica la solución en pasos claros y sin tecnicismos.',
  },
  {
    key: 'closing',
    label: 'Cierre y siguiente paso',
    hint: 'Resume, confirma y deja el siguiente paso acordado.',
  },
];

export const QA_MAX_PER_CRITERION = 5;

export interface QaCriterionScore {
  key: string;
  label: string;
  score: number;
  max: number;
}

/** Puntaje 0–100 a partir de las notas por criterio. */
export function computeEvaluationScore(
  scores: Record<string, number>
): number {
  const total = QA_CRITERIA.reduce((sum, criterion) => {
    const raw = scores[criterion.key];
    const value = Number.isFinite(raw) ? Number(raw) : 0;
    return sum + Math.min(QA_MAX_PER_CRITERION, Math.max(0, value));
  }, 0);
  const max = QA_CRITERIA.length * QA_MAX_PER_CRITERION;
  return Math.round((total / max) * 100);
}

/**
 * Normaliza las notas a la forma que se guarda en `criteria` (JSONB),
 * descartando claves desconocidas y recortando al rango 0–5.
 */
export function normalizeCriteria(
  scores: Record<string, number>
): QaCriterionScore[] {
  return QA_CRITERIA.map((criterion) => {
    const raw = scores[criterion.key];
    const value = Number.isFinite(raw) ? Number(raw) : 0;
    return {
      key: criterion.key,
      label: criterion.label,
      score: Math.min(QA_MAX_PER_CRITERION, Math.max(0, Math.round(value))),
      max: QA_MAX_PER_CRITERION,
    };
  });
}

export interface QaSummary {
  count: number;
  average: number | null;
  /** Evaluaciones / llamadas contestadas (0–1). */
  coverage: number | null;
}

/** Resume las notas de un periodo. */
export function summarizeQa(
  scores: number[],
  answeredCalls: number
): QaSummary {
  const valid = scores.filter(
    (score) => Number.isFinite(score) && score >= 0 && score <= 100
  );
  if (valid.length === 0) {
    return { count: 0, average: null, coverage: 0 };
  }
  const average = Math.round(
    valid.reduce((sum, score) => sum + score, 0) / valid.length
  );
  const coverage = answeredCalls
    ? Math.min(1, Math.round((valid.length / answeredCalls) * 1000) / 1000)
    : null;
  return { count: valid.length, average, coverage };
}
