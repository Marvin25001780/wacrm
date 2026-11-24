/**
 * 131 — acciones disponibles sobre una PTP.
 *
 * La lógica vive aquí (sin React) para que consola y supervisión pinten
 * exactamente las mismas opciones y para poder probarla. El servidor
 * vuelve a validar permisos: la UI no es la autoridad.
 */

import type { CollectionPromiseStatus } from "@/types/collections";

export type PromiseResolution = "kept" | "broken" | "cancelled" | "pending";

export type PromiseResolutionTone = "positive" | "negative" | "neutral";

export interface PromiseResolutionOption {
  value: PromiseResolution;
  label: string;
  /** Texto para el tooltip del botón. */
  hint: string;
  tone: PromiseResolutionTone;
}

/** Estados que todavía admiten cierre. */
export function isPromiseOpen(status: string | null | undefined): boolean {
  return status === "pending" || status === "partial";
}

const CLOSE_OPTIONS: PromiseResolutionOption[] = [
  {
    value: "kept",
    label: "Cumplida",
    hint: "El deudor pagó lo prometido",
    tone: "positive",
  },
  {
    value: "broken",
    label: "Rota",
    hint: "No pagó y la promesa se da por incumplida",
    tone: "negative",
  },
  {
    value: "cancelled",
    label: "Cancelar",
    hint: "El acuerdo se anuló (no cuenta como rota)",
    tone: "neutral",
  },
];

const REOPEN_OPTION: PromiseResolutionOption = {
  value: "pending",
  label: "Reabrir",
  hint: "Solo supervisión: devuelve la PTP a abierta",
  tone: "neutral",
};

/**
 * Opciones visibles según el estado actual y el rol. Un agente solo ve
 * cierre; un admin/owner además puede reabrir una PTP cerrada.
 */
export function availablePromiseResolutions(
  status: string | null | undefined,
  canReopen = false,
): PromiseResolutionOption[] {
  if (isPromiseOpen(status)) return CLOSE_OPTIONS;
  if (
    canReopen &&
    (status === "kept" || status === "broken" || status === "cancelled")
  ) {
    return [REOPEN_OPTION];
  }
  return [];
}

/** Texto de confirmación/éxito para el toast. */
export function resolutionMessage(
  option: PromiseResolution,
  debtorName?: string | null,
): string {
  const name = debtorName ? ` de ${debtorName}` : "";
  switch (option) {
    case "kept":
      return `PTP${name} marcada como cumplida`;
    case "broken":
      return `PTP${name} marcada como rota`;
    case "cancelled":
      return `PTP${name} cancelada`;
    case "pending":
      return `PTP${name} reabierta`;
  }
}

/** Conteo de promesas vencidas según los días que devuelve el servidor. */
export function overduePromiseCount(
  promises: Array<{ status: string; days_left: number }>,
): number {
  return promises.filter(
    (promise) => isPromiseOpen(promise.status) && promise.days_left < 0,
  ).length;
}

export function isPromiseStatus(value: string): value is CollectionPromiseStatus {
  return [
    "pending",
    "kept",
    "partial",
    "broken",
    "cancelled",
  ].includes(value);
}
