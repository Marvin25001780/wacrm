// ============================================================
// Resumen de llamada con IA — armado del prompt y limpieza.
//
// La transcripción completa sirve para auditar, pero el agente
// necesita el resultado en dos líneas. Este módulo construye el
// texto que se manda al proveedor de IA del negocio y normaliza la
// respuesta antes de guardarla en `call_sessions.ai_summary`.
//
// Sin I/O ni SDK: se prueba con cadenas, igual que `calls.ts`.
// ============================================================

import type { CallDirection } from '@/types';

/** Instrucción del sistema. Pide datos solo de la transcripción. */
export const CALL_SUMMARY_SYSTEM_PROMPT = [
  'Eres un supervisor de contact center y resumes llamadas telefónicas para un CRM.',
  'Responde en español neutro y usa únicamente lo que aparece en la transcripción.',
  'Si algo no se menciona, escribe "No se indicó". Nunca inventes datos, montos ni fechas.',
  'Devuelve texto plano, sin Markdown, sin comillas y sin saludos, con estas cuatro líneas:',
  'Resumen: una o dos frases con lo que pasó en la llamada.',
  'Motivo: la razón principal por la que el cliente llamó o fue llamado.',
  'Acuerdos: compromisos concretos (o "Ninguno").',
  'Siguiente paso: la acción recomendada para el agente (o "Sin acción pendiente").',
].join('\n');

export interface CallSummaryInput {
  direction: CallDirection;
  /** Número del otro extremo, ya normalizado o tal cual llegó. */
  number?: string | null;
  contactName?: string | null;
  /** Duración legible (`4:31`), si se conoce. */
  durationLabel?: string | null;
  transcript: string;
}

/**
 * Texto de usuario que acompaña la transcripción. Incluye el contexto
 * mínimo (dirección, contacto, duración) porque la transcripción sola
 * no dice a quién se llamó ni cuánto duró.
 */
export function buildCallSummaryContent(input: CallSummaryInput): string {
  const direction =
    input.direction === 'inbound' ? 'entrante' : 'saliente';
  const counterpart =
    input.contactName?.trim() ||
    input.number?.trim() ||
    'número desconocido';

  const context = [
    `Tipo de llamada: ${direction}`,
    `Interlocutor: ${counterpart}`,
  ];
  if (input.durationLabel?.trim()) {
    context.push(`Duración: ${input.durationLabel.trim()}`);
  }

  return [
    context.join('\n'),
    '',
    'Transcripción:',
    input.transcript.trim(),
  ].join('\n');
}

/**
 * Normaliza la respuesta del modelo: quita cercas de código, recorta
 * espacios y limita el tamaño para que quepa en la columna sin ruido.
 */
export function cleanCallSummary(raw: string, maxLength = 1200): string {
  let text = raw.trim();

  // Algunos modelos envuelven la respuesta en ```text ... ```.
  text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```$/, '');

  text = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return text;
}
