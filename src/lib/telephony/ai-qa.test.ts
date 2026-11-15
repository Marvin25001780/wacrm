import { describe, expect, it } from 'vitest';

import {
  AI_QA_SYSTEM_PROMPT,
  buildAiQaContent,
  parseAiEvaluation,
} from './ai-qa';

describe('buildAiQaContent', () => {
  it('incluye dirección, contacto, duración y transcripción', () => {
    const content = buildAiQaContent({
      direction: 'inbound',
      contactName: 'Ana',
      durationLabel: '2:10',
      transcript: 'Cliente: necesito una cotización.',
    });
    expect(content).toContain('Tipo de llamada: entrante');
    expect(content).toContain('Interlocutor: Ana');
    expect(content).toContain('Duración: 2:10');
    expect(content).toContain('Cliente: necesito una cotización.');
  });

  it('omite contacto y duración cuando no existen', () => {
    const content = buildAiQaContent({
      direction: 'outbound',
      transcript: 'Hola.',
    });
    expect(content).toContain('Tipo de llamada: saliente');
    expect(content).not.toContain('Interlocutor:');
    expect(content).not.toContain('Duración:');
  });
});

describe('parseAiEvaluation', () => {
  it('lee el JSON esperado y calcula el puntaje', () => {
    const parsed = parseAiEvaluation(
      '{"criteria":{"greeting":5,"identification":5,"listening":5,"resolution":5,"closing":5},"summary":"Excelente trato."}'
    );
    expect(parsed?.score).toBe(100);
    expect(parsed?.summary).toBe('Excelente trato.');
    expect(parsed?.criteria).toHaveLength(5);
  });

  it('tolera cercas de código y texto alrededor', () => {
    const parsed = parseAiEvaluation(
      '```json\n{"criteria":{"greeting":4,"identification":4,"listening":3,"resolution":4,"closing":5},"summary":"Bien."}\n```'
    );
    expect(parsed?.score).toBe(80);
  });

  it('acepta criterios como lista', () => {
    const parsed = parseAiEvaluation(
      '{"criteria":[{"key":"greeting","score":5},{"key":"closing","score":5}],"feedback":"Corto."}'
    );
    // Solo dos criterios con nota; el resto cuenta como 0.
    expect(parsed?.score).toBe(40);
    expect(parsed?.summary).toBe('Corto.');
  });

  it('acota notas fuera de rango y descarta claves desconocidas', () => {
    const parsed = parseAiEvaluation(
      '{"criteria":{"greeting":99,"unknown":5}}'
    );
    expect(parsed?.score).toBe(20);
    expect(parsed?.criteria.some((row) => row.key === 'unknown')).toBe(false);
  });

  it('devuelve null sin JSON o sin criterios conocidos', () => {
    expect(parseAiEvaluation('sin json')).toBeNull();
    expect(parseAiEvaluation('{"criteria":{"unknown":5}}')).toBeNull();
    expect(parseAiEvaluation('{"summary":"solo texto"}')).toBeNull();
    expect(parseAiEvaluation('{roto')).toBeNull();
  });
});

describe('AI_QA_SYSTEM_PROMPT', () => {
  it('exige JSON y prohíbe inventar', () => {
    expect(AI_QA_SYSTEM_PROMPT).toContain('No inventes datos');
    expect(AI_QA_SYSTEM_PROMPT).toContain('únicamente JSON válido');
    expect(AI_QA_SYSTEM_PROMPT).toContain('greeting');
    expect(AI_QA_SYSTEM_PROMPT).toContain('closing');
  });
});
