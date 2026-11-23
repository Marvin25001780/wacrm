/**
 * 130 — contactabilidad por hora.
 *
 * La consulta (`collection_contactability`) devuelve conteos reales por
 * día de la semana y hora local. Aquí se convierten en una matriz para
 * el mapa de calor y en la lista de mejores franjas. Nada se estima: si
 * no hay intentos, no hay tasa.
 */

import type { CollectionContactabilityRow } from "@/types/collections";

export const CONTACT_DAYS = 30;

/** ISO: 1 = lunes … 7 = domingo. */
export const CONTACT_WEEKDAYS = [
  { value: 1, short: "Lun", label: "Lunes" },
  { value: 2, short: "Mar", label: "Martes" },
  { value: 3, short: "Mié", label: "Miércoles" },
  { value: 4, short: "Jue", label: "Jueves" },
  { value: 5, short: "Vie", label: "Viernes" },
  { value: 6, short: "Sáb", label: "Sábado" },
  { value: 7, short: "Dom", label: "Domingo" },
] as const;

export interface ContactabilityCell {
  attempts: number;
  contacts: number;
  rate: number;
}

export interface ContactabilitySlot extends ContactabilityCell {
  weekday: number;
  hour: number;
}

/** Porcentaje 0–100; 0 cuando no hubo intentos. */
export function contactRate(
  contacts: number | null | undefined,
  attempts: number | null | undefined,
): number {
  const c = Number(contacts ?? 0);
  const a = Number(attempts ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(a) || a <= 0) return 0;
  return Math.min(100, Math.max(0, (c / a) * 100));
}

export function weekdayLabel(weekday: number): string {
  return (
    CONTACT_WEEKDAYS.find((day) => day.value === weekday)?.label ?? "—"
  );
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function slotLabel(weekday: number, hour: number): string {
  return `${weekdayLabel(weekday)} ${hourLabel(hour)}–${hourLabel(hour + 1)}`;
}

/** Rango de horas a pintar: 6–21 por defecto, ampliado si hay datos. */
export function contactabilityHours(
  rows: CollectionContactabilityRow[],
): number[] {
  let from = 6;
  let to = 21;

  for (const row of rows) {
    if (Number(row.attempts) <= 0) continue;
    from = Math.min(from, Number(row.hour_of_day));
    to = Math.max(to, Number(row.hour_of_day));
  }

  from = Math.max(0, from);
  to = Math.min(23, to);

  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/** Matriz de 7 días × horas pedidas. */
export function buildContactabilityGrid(
  rows: CollectionContactabilityRow[],
  hours: number[],
): Array<{ weekday: number; label: string; cells: ContactabilityCell[] }> {
  const byKey = new Map<string, ContactabilityCell>();

  for (const row of rows) {
    const attempts = Number(row.attempts) || 0;
    const contacts = Number(row.contacts) || 0;
    byKey.set(`${Number(row.weekday)}-${Number(row.hour_of_day)}`, {
      attempts,
      contacts,
      rate: contactRate(contacts, attempts),
    });
  }

  return CONTACT_WEEKDAYS.map((day) => ({
    weekday: day.value,
    label: day.label,
    cells: hours.map(
      (hour) =>
        byKey.get(`${day.value}-${hour}`) ?? {
          attempts: 0,
          contacts: 0,
          rate: 0,
        },
    ),
  }));
}

export function contactabilityTotals(rows: CollectionContactabilityRow[]): {
  attempts: number;
  contacts: number;
  rate: number;
} {
  let attempts = 0;
  let contacts = 0;

  for (const row of rows) {
    attempts += Number(row.attempts) || 0;
    contacts += Number(row.contacts) || 0;
  }

  return { attempts, contacts, rate: contactRate(contacts, attempts) };
}

/**
 * Mejores franjas por tasa de contacto, exigiendo un mínimo de intentos
 * para no recomendar una hora por un solo caso. Desempata por volumen.
 */
export function bestContactSlots(
  rows: CollectionContactabilityRow[],
  minAttempts = 5,
  limit = 3,
): ContactabilitySlot[] {
  return rows
    .map((row) => {
      const attempts = Number(row.attempts) || 0;
      const contacts = Number(row.contacts) || 0;
      return {
        weekday: Number(row.weekday),
        hour: Number(row.hour_of_day),
        attempts,
        contacts,
        rate: contactRate(contacts, attempts),
      };
    })
    .filter((slot) => slot.attempts >= Math.max(1, minAttempts))
    .sort(
      (a, b) =>
        b.rate - a.rate ||
        b.contacts - a.contacts ||
        b.attempts - a.attempts ||
        a.weekday - b.weekday ||
        a.hour - b.hour,
    )
    .slice(0, Math.max(1, limit));
}
