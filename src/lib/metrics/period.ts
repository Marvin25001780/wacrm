// ============================================================
// Períodos de tiempo — módulo de Métricas.
//
// Fuente única de verdad de "qué rango de fechas" significan las
// opciones del desplegable (Hoy, Ayer, últimos 7/30/90 días y un
// rango personalizado). Todo se calcula en la hora LOCAL del usuario
// y los límites se convierten a ISO para consultar Supabase con
// `.gte(fromIso).lt(toIsoExclusive)`.
// ============================================================

import { localDayKey } from "@/lib/dashboard/date-utils";

export type PeriodPreset =
  | "today"
  | "yesterday"
  | "7"
  | "30"
  | "90"
  | "custom";

export interface PeriodOption {
  key: PeriodPreset;
  label: string;
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { key: "today", label: "Hoy" },
  { key: "yesterday", label: "Ayer" },
  { key: "7", label: "Últimos 7 días" },
  { key: "30", label: "Últimos 30 días" },
  { key: "90", label: "Últimos 90 días" },
  { key: "custom", label: "Personalizado" },
];

export interface ResolvedRange {
  /** Primer día incluido, a las 00:00 locales. */
  start: Date;
  /** Último día incluido, a las 00:00 locales. */
  end: Date;
  /** Número de días del rango (end - start + 1). */
  days: number;
}

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Parsea "YYYY-MM-DD" como día local; null si no es válido. */
function parseDayKey(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : startOfLocalDay(date);
}

/**
 * Resuelve el preset a un rango concreto de días locales.
 * Para `custom` usa `customStart`/`customEnd` (YYYY-MM-DD); si faltan
 * o están invertidos, cae al preset de 7 días.
 */
export function resolveRange(
  preset: PeriodPreset,
  customStart?: string | null,
  customEnd?: string | null
): ResolvedRange {
  const today = startOfLocalDay(new Date());

  switch (preset) {
    case "today":
      return { start: today, end: today, days: 1 };
    case "yesterday": {
      const y = addDays(today, -1);
      return { start: y, end: y, days: 1 };
    }
    case "7":
      return { start: addDays(today, -6), end: today, days: 7 };
    case "30":
      return { start: addDays(today, -29), end: today, days: 30 };
    case "90":
      return { start: addDays(today, -89), end: today, days: 90 };
    case "custom": {
      const s = parseDayKey(customStart);
      const e = parseDayKey(customEnd);
      if (!s || !e || s > e) {
        return { start: addDays(today, -6), end: today, days: 7 };
      }
      const days =
        Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
      // Tope defensivo para no traer series enormes.
      return { start: s, end: e, days: Math.min(days, 366) };
    }
  }
}

/** Límites ISO para Supabase: [fromIso, toIsoExclusive). */
export function rangeToIso(range: ResolvedRange): {
  fromIso: string;
  toIsoExclusive: string;
} {
  return {
    fromIso: range.start.toISOString(),
    toIsoExclusive: addDays(range.end, 1).toISOString(),
  };
}

/** Todas las claves "YYYY-MM-DD" (locales) del rango, inclusivo. */
export function dayKeysInRange(range: ResolvedRange): string[] {
  const keys: string[] = [];
  for (let i = 0; i < range.days; i++) {
    keys.push(localDayKey(addDays(range.start, i)));
  }
  return keys;
}

/** Etiqueta corta de un día: "12 oct". */
export function shortDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-ES", {
    month: "short",
    day: "numeric",
  });
}

/** Describe el rango para mostrar en la UI. */
export function formatRangeLabel(range: ResolvedRange): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  };
  if (range.days === 1) {
    return range.start.toLocaleDateString("es-ES", opts);
  }
  return `${range.start.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  })} – ${range.end.toLocaleDateString("es-ES", opts)}`;
}
