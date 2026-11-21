// ============================================================
// Supervisión de cobranza (migración 126) — lógica pura.
//
// La RPC entrega las filas; aquí solo se normalizan, se calcula el
// resumen del turno y se escriben las etiquetas. Nada de números
// inventados: si la base no devuelve el dato, el resumen queda en 0.
// ============================================================

import type {
  CollectionSupervisorPromise,
  CollectionSupervisorRow,
} from "@/types/collections";

/** Ventana por defecto de promesas en el tablero. */
export const SUPERVISION_DAYS = 7;
/** Refresco automático del tablero (30 s). */
export const SUPERVISION_REFRESH_MS = 30_000;
/** Tope de casos que se entregan a un gestor en un reparto. */
export const MAX_PER_AGENT = 50;
/** Valor inicial del reparto. */
export const DEFAULT_PER_AGENT = 10;

export interface SupervisionSummary {
  agents: number;
  assigned: number;
  actionsToday: number;
  contactsToday: number;
  ptpToday: number;
  dueToday: number;
  overdue: number;
  broken30d: number;
  /** Contactos efectivos sobre gestiones del día (0 si no hubo). */
  contactRate: number;
}

/**
 * Convierte lo que venga del formulario en un entero 1..50.
 * Un valor inválido cae al valor por defecto en vez de romper.
 */
export function clampPerAgent(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_PER_AGENT;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PER_AGENT;
  return Math.min(MAX_PER_AGENT, Math.max(1, Math.floor(parsed)));
}

/** Ventana de promesas: entero 0..60, con 7 por defecto. */
export function normalizeDays(value: unknown, fallback = SUPERVISION_DAYS): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(60, Math.max(0, Math.floor(parsed)));
}

/**
 * Etiqueta de vencimiento de una promesa. `daysLeft` viene del
 * servidor con el calendario del negocio, no del reloj del navegador.
 */
export function daysLeftLabel(daysLeft: number): string {
  const days = Math.trunc(Number(daysLeft) || 0);
  if (days < 0) {
    const missed = Math.abs(days);
    return missed === 1 ? "Venció ayer" : `Vencida hace ${missed} d`;
  }
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence mañana";
  return `Vence en ${days} d`;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Resumen del turno a partir del tablero por gestor. */
export function summarizeBoard(rows: CollectionSupervisorRow[]): SupervisionSummary {
  const summary = rows.reduce<SupervisionSummary>(
    (acc, row) => {
      acc.actionsToday += num(row.actions_today);
      acc.contactsToday += num(row.contacts_today);
      acc.ptpToday += num(row.ptp_today);
      acc.dueToday += num(row.promises_due_today);
      acc.overdue += num(row.promises_overdue);
      acc.broken30d += num(row.broken_promises_30d);
      acc.assigned += num(row.assigned_count);
      return acc;
    },
    {
      agents: rows.length,
      assigned: 0,
      actionsToday: 0,
      contactsToday: 0,
      ptpToday: 0,
      dueToday: 0,
      overdue: 0,
      broken30d: 0,
      contactRate: 0,
    }
  );

  summary.contactRate =
    summary.actionsToday > 0
      ? (summary.contactsToday / summary.actionsToday) * 100
      : 0;

  return summary;
}

/** Filtra las promesas del gestor seleccionado; `null` = todas. */
export function filterPromisesByAgent(
  rows: CollectionSupervisorPromise[],
  userId: string | null
): CollectionSupervisorPromise[] {
  if (!userId) return rows;
  return rows.filter((row) => row.agent_user_id === userId);
}

/** Etiqueta legible del estado de presencia del softphone. */
export function agentStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "available":
      return "Disponible";
    case "busy":
      return "En llamada";
    case "wrap_up":
      return "After-call";
    case "break":
      return "En pausa";
    default:
      return "Sin señal";
  }
}
