import { describe, expect, it } from 'vitest';

import {
  buildCallSummaryContent,
  CALL_SUMMARY_SYSTEM_PROMPT,
  cleanCallSummary,
} from './summary';

describe('buildCallSummaryContent', () => {
  it('describe una saliente con contacto y duración', () => {
    const content = buildCallSummaryContent({
      direction: 'outbound',
      number: '+584121234567',
      contactName: 'María Pérez',
      durationLabel: '4:31',
      transcript: 'Cliente pide cotización de 20 equipos.',
    });

    expect(content).toContain('Tipo de llamada: saliente');
    expect(content).toContain('Interlocutor: María Pérez');
    expect(content).toContain('Duración: 4:31');
    expect(content).toContain('Transcripción:');
    expect(content).toContain('Cliente pide cotización de 20 equipos.');
  });

  it('usa el número cuando no hay nombre y marca la entrante', () => {
    const content = buildCallSummaryContent({
      direction: 'inbound',
      number: '+582121234567',
      transcript: 'Consulta de horario.',
    });

    expect(content).toContain('Tipo de llamada: entrante');
    expect(content).toContain('Interlocutor: +582121234567');
    expect(content).not.toContain('Duración:');
  });

  it('cae a "número desconocido" sin nombre ni número', () => {
    const content = buildCallSummaryContent({
      direction: 'inbound',
      transcript: 'Sin audio útil.',
    });

    expect(content).toContain('Interlocutor: número desconocido');
  });
});

describe('cleanCallSummary', () => {
  it('quita cercas de código y espacios sobrantes', () => {
    const raw = '```\nResumen: probó el servicio.\n\n\nSiguiente paso: llamar.\n```';
    expect(cleanCallSummary(raw)).toBe(
      'Resumen: probó el servicio.\n\nSiguiente paso: llamar.'
    );
  });

  it('recorta a la longitud máxima con elipsis', () => {
    const result = cleanCallSummary('x'.repeat(50), 20);
    expect(result).toHaveLength(20);
    expect(result.endsWith('…')).toBe(true);
  });

  it('devuelve vacío si no hay texto', () => {
    expect(cleanCallSummary('   ')).toBe('');
  });
});

describe('CALL_SUMMARY_SYSTEM_PROMPT', () => {
  it('pide no inventar datos y cuatro secciones', () => {
    expect(CALL_SUMMARY_SYSTEM_PROMPT).toContain('Nunca inventes datos');
    expect(CALL_SUMMARY_SYSTEM_PROMPT).toContain('Resumen:');
    expect(CALL_SUMMARY_SYSTEM_PROMPT).toContain('Motivo:');
    expect(CALL_SUMMARY_SYSTEM_PROMPT).toContain('Acuerdos:');
    expect(CALL_SUMMARY_SYSTEM_PROMPT).toContain('Siguiente paso:');
  });
});
