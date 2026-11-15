// ============================================================
// Teléfonos — normalización para marcar y para casar contactos.
//
// El CRM es venezolano: si el número viene local (0412…, 0212…)
// se interpreta con +58. Todo lo que sale al softphone va en E.164.
// Los números inválidos se rechazan ANTES de crear la llamada, para
// no dejar filas "fallidas" por un error de tipeo.
// ============================================================

import {
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

export const DEFAULT_PHONE_COUNTRY: CountryCode = 'VE';

/**
 * Devuelve el número en E.164 (`+584121234567`) o null si no es un
 * número válido. Acepta formato local venezolano, internacional con
 * `+` y prefijo internacional `00`.
 */
export function normalizePhone(
  raw: unknown,
  country: CountryCode = DEFAULT_PHONE_COUNTRY
): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;

  // "00 58 …" es la forma internacional que usa mucha gente en VE.
  const candidate = value.startsWith('00') ? `+${value.slice(2)}` : value;
  const parsed = parsePhoneNumberFromString(candidate, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** ¿Se puede marcar este número? */
export function isDialablePhone(
  raw: unknown,
  country: CountryCode = DEFAULT_PHONE_COUNTRY
): boolean {
  return normalizePhone(raw, country) !== null;
}

/** Formato legible para la ficha y el historial. */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return '';
  const parsed = parsePhoneNumberFromString(raw);
  if (!parsed) return raw;
  return parsed.formatInternational();
}

/** Ambos números son el mismo, aunque uno venga local y otro E.164. */
export function samePhone(a: unknown, b: unknown): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  return Boolean(left && right && left === right);
}

/**
 * Clave de búsqueda para casar una llamada con un contacto. Usa los
 * últimos 7 dígitos porque en Venezuela hay números que se escriben
 * con y sin el 0 inicial o con distintos prefijos de operadora.
 */
export function phoneLookupKey(raw: unknown): string | null {
  const e164 = normalizePhone(raw);
  if (e164) return e164.replace(/\D/g, '').slice(-7);
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-7) : null;
}
