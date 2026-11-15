// ============================================================
// QA automática con IA.
//
// A partir de la transcripción, el proveedor de IA del negocio
// devuelve una nota por criterio de la misma rúbrica humana
// (`qa.ts`). El JSON del modelo es entrada no confiable: se parsea,
// se acota y se recalcula el puntaje en el servidor.
//
// Sin I/O ni SDK: se prueba con cadenas, como `summary.ts`.
// ============================================================

import {
  computeEvaluationScore,
  normalizeCriteria,
  QA_CRITERIA,
  QA_MAX_PER_CRITERION,
  type QaCriterionScore,
} from './qa';

export const AI_QA_SYSTEM_PROMPT = [
  'Eres un supervisor de calidad de un contact center. Evalúa la llamada usando SOLO la transcripción.',
  'No inventes datos. Si no hay evidencia de un criterio, pon 0 en ese criterio.',
  'Puntúa cada criterio de 0 a ' + QA_MAX_PER_CRITERION + ':',
  ...QA_CRITERIA.map(
    (criterion) => `- ${criterion.key}: ${criterion.label} (${criterion.hint})`
  ),
  'Devuelve únicamente JSON válido, sin Markdown ni texto extra, con esta forma:',
  '{"criteria":{"greeting":0,"identification":0,"listening":0,"resolution":0,"closing":0},"summary":"una o dos frases de feedback para el agente"}',
].join('\n');

export interface AiQaInput {
  transcript: string;
  direction: 'inbound' | 'outbound';
  durationLabel?: string | null;
  contactName?: string | null;
}

export function buildAiQaContent(input: AiQaInput): string {
  const context = [
    `Tipo de llamada: ${input.direction === 'inbound' ? 'entrante' : 'saliente'}`,
  ];
  if (input.contactName?.trim()) {
    context.push(`Interlocutor: ${input.contactName.trim()}`);
  }
  if (input.durationLabel?.trim()) {
    context.push(`Duración: ${input.durationLabel.trim()}`);
  }
  return [context.join('\n'), '', 'Transcripción:', input.transcript.trim()].join(
    '\n'
  );
}

export interface ParsedAiEvaluation {
  score: number;
  criteria: QaCriterionScore[];
  summary: string;
}

/**
 * Extrae el JSON de la respuesta del modelo. Acepta cercas de código y
 * texto alrededor; devuelve `null` si no hay un objeto con al menos un
 * criterio conocido.
 */
export function parseAiEvaluation(raw: string): ParsedAiEvaluation | null {
  let text = raw.trim();
  text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```$/, '');

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const body = parsed as {
    criteria?: unknown;
    summary?: unknown;
    feedback?: unknown;
    resumen?: unknown;
  };

  const rawScores = readCriteria(body.criteria);
  if (!rawScores) return null;

  const summary =
    typeof body.summary === 'string'
      ? body.summary
      : typeof body.feedback === 'string'
        ? body.feedback
        : typeof body.resumen === 'string'
          ? body.resumen
          : '';

  return {
    score: computeEvaluationScore(rawScores),
    criteria: normalizeCriteria(rawScores),
    summary: summary.trim().slice(0, 1000),
  };
}

function readCriteria(value: unknown): Record<string, number> | null {
  if (!value) return null;
  const known = new Set(QA_CRITERIA.map((criterion) => criterion.key));
  const scores: Record<string, number> = {};

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { key?: unknown; score?: unknown };
      if (typeof row.key !== 'string' || !known.has(row.key)) continue;
      const numeric = typeof row.score === 'number' ? row.score : Number(row.score);
      if (Number.isFinite(numeric)) scores[row.key] = numeric;
    }
    return Object.keys(scores).length > 0 ? scores : null;
  }

  if (typeof value === 'object') {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!known.has(key)) continue;
      const numeric = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(numeric)) scores[key] = numeric;
    }
    return Object.keys(scores).length > 0 ? scores : null;
  }

  return null;
}
