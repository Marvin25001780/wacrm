// ============================================================
// Historial de llamadas — filtros y paginación (sin migración).
//
// /telefonia muestra las últimas 50 llamadas; para encontrar una en
// concreto (un número, un agente, un resultado, un día) hace falta
// filtrar. Aquí viven la validación de los filtros y el cálculo de la
// ventana, puros y testeables; la API solo los aplica.
//
// La búsqueda por texto se resuelve en dos pasos en la API:
//   * números → clave de 7 dígitos sobre `from_number`/`to_number`;
//   * nombres → ids de `contacts` que luego filtran `contact_id`.
// ============================================================

import {
  CALL_DIRECTIONS,
  CALL_SESSION_STATUSES,
  isCallDisposition,
  type CallDirection,
  type CallDisposition,
  type CallSessionStatus,
} from '@/types';
import { phoneLookupKey } from './phone';
import { businessDayKey } from './reports';

/** Ventanas ofrecidas en la interfaz. `0` = todo el historial. */
export const HISTORY_DAYS = [7, 30, 90, 0] as const;

export const HISTORY_PAGE_SIZES = [25, 50, 100] as const;

export const HISTORY_DEFAULT_DAYS = 30;
export const HISTORY_DEFAULT_LIMIT = 25;
export const HISTORY_MAX_Q = 60;
export const HISTORY_MAX_OFFSET = 100_000;

export interface HistoryFilters {
  q: string;
  direction: CallDirection | '';
  status: CallSessionStatus | '';
  disposition: CallDisposition | '';
  agent: string;
  /** Días hacia atrás; `0` = sin límite. */
  days: number;
  limit: number;
  offset: number;
}

function pickNumber(
  value: string | null,
  allowed: readonly number[],
  fallback: number
) {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.floor(parsed);
  return allowed.includes(integer) ? integer : fallback;
}

/**
 * Lee y valida los parámetros de la URL. Nunca lanza: lo que no
 * entiende vuelve al valor por defecto, para que un enlace viejo no
 * rompa el historial.
 */
export function parseHistoryFilters(params: URLSearchParams): HistoryFilters {
  const rawQ = (params.get('q') ?? '').trim().slice(0, HISTORY_MAX_Q);

  const rawDirection = params.get('direction') ?? '';
  const direction = CALL_DIRECTIONS.some((item) => item.value === rawDirection)
    ? (rawDirection as CallDirection)
    : '';

  const rawStatus = params.get('status') ?? '';
  const status = CALL_SESSION_STATUSES.some((item) => item.value === rawStatus)
    ? (rawStatus as CallSessionStatus)
    : '';

  const rawDisposition = params.get('disposition') ?? '';
  const disposition = isCallDisposition(rawDisposition) ? rawDisposition : '';

  const rawAgent = (params.get('agent') ?? '').trim();
  const agent = /^[0-9a-f-]{36}$/i.test(rawAgent) ? rawAgent : '';

  const rawLimit = Number(params.get('limit'));
  const limit = HISTORY_PAGE_SIZES.includes(rawLimit as 25 | 50 | 100)
    ? rawLimit
    : HISTORY_DEFAULT_LIMIT;

  const rawOffset = Number(params.get('offset'));
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0
      ? Math.min(HISTORY_MAX_OFFSET, Math.floor(rawOffset))
      : 0;

  return {
    q: rawQ,
    direction,
    status,
    disposition,
    agent,
    days: pickNumber(
      params.get('days'),
      HISTORY_DAYS as unknown as readonly number[],
      HISTORY_DEFAULT_DAYS
    ),
    limit,
    offset,
  };
}

/**
 * Inicio de la ventana en ISO, o `null` cuando el filtro es "todo".
 * Caracas no tiene horario de verano: el día empieza a las -04:00.
 */
export function historyFromIso(days: number, now: number = Date.now()): string | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  const span = Math.max(1, Math.floor(days));
  const firstKey = businessDayKey(
    new Date(now - (span - 1) * 86_400_000).toISOString()
  );
  return new Date(`${firstKey}T00:00:00-04:00`).toISOString();
}

/** Parámetros para pedir el historial (los usa la pantalla). */
export function historyQuery(filters: HistoryFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.status) params.set('status', filters.status);
  if (filters.disposition) params.set('disposition', filters.disposition);
  if (filters.agent) params.set('agent', filters.agent);
  params.set('days', String(filters.days));
  params.set('limit', String(filters.limit));
  if (filters.offset > 0) params.set('offset', String(filters.offset));
  return params.toString();
}

/**
 * ¿Hay algo más que la ventana por defecto? Se usa para mostrar el
 * botón "Limpiar" solo cuando de verdad hay filtros activos.
 */
export function hasHistoryFilters(filters: HistoryFilters): boolean {
  return Boolean(
    filters.q ||
      filters.direction ||
      filters.status ||
      filters.disposition ||
      filters.agent ||
      filters.days !== HISTORY_DEFAULT_DAYS
  );
}

/**
 * Términos de búsqueda para la API. Devuelve la clave telefónica
 * (últimos 7 dígitos) y el texto para buscar en nombres de contacto.
 * Un mismo texto puede ser las dos cosas ("0412…" y "Ana").
 */
export function historySearchTerms(raw: string): {
  phoneKey: string | null;
  text: string;
} {
  const text = raw.trim().slice(0, HISTORY_MAX_Q);
  if (!text) return { phoneKey: null, text: '' };
  const digits = text.replace(/\D/g, '');
  // Con 3 o más dígitos se intenta como teléfono; menos sería ruido.
  const phoneKey = digits.length >= 3 ? phoneLookupKey(text) ?? digits : null;
  return { phoneKey, text };
}

/** ¿La búsqueda es solo un número? Entonces no vale la pena ir a contactos. */
export function isPhoneOnlySearch(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.length > 0 && /^[+\d\s()-]+$/.test(trimmed);
}
