/**
 * 129 — SLA de primera respuesta.
 *
 * Lógica pura para mostrar cuánto lleva esperando un deudor y si el
 * negocio ya rompió su compromiso. El tiempo lo calcula el servidor
 * (`collection_agent_queue().waiting_minutes`); aquí solo se formatea y
 * se clasifica, sin inventar umbrales: el nivel sale del SLA configurado
 * en `collection_settings.response_sla_minutes`.
 */

export const DEFAULT_RESPONSE_SLA_MINUTES = 30;

export type SlaLevel = "ok" | "warn" | "late";

/** Deja el SLA en un entero razonable (1–1440 minutos). */
export function normalizeSlaMinutes(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number(value ?? DEFAULT_RESPONSE_SLA_MINUTES);
  if (!Number.isFinite(parsed)) return DEFAULT_RESPONSE_SLA_MINUTES;
  return Math.min(1440, Math.max(1, Math.round(parsed)));
}

/**
 * “menos de 1 min”, “4 min”, “2 h 5 min”, “3 d 4 h”.
 * Devuelve “—” cuando no hay espera (null/negativo).
 */
export function formatWaiting(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "—";

  const total = Math.floor(minutes);
  if (total < 1) return "menos de 1 min";
  if (total < 60) return `${total} min`;

  const hours = Math.floor(total / 60);
  const restMinutes = total % 60;
  if (hours < 24) {
    return restMinutes === 0 ? `${hours} h` : `${hours} h ${restMinutes} min`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} d` : `${days} d ${restHours} h`;
}

/** “hace 12 min” o “—” si no hay espera. */
export function waitingLabel(minutes: number | null | undefined): string {
  const value = formatWaiting(minutes);
  return value === "—" ? value : `hace ${value}`;
}

/**
 * ok: todavía dentro de la primera mitad del SLA.
 * warn: pasó la mitad, aún no lo rompe.
 * late: ya llegó o superó el SLA.
 */
export function slaLevel(
  minutes: number | null | undefined,
  slaMinutes: unknown = DEFAULT_RESPONSE_SLA_MINUTES,
): SlaLevel | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;

  const sla = normalizeSlaMinutes(slaMinutes);
  if (minutes >= sla) return "late";
  if (minutes >= sla / 2) return "warn";
  return "ok";
}

/**
 * Minutos transcurridos entre un instante y la última lectura del
 * servidor. Sirve para medir la antigüedad con el reloj del servidor y
 * no con el del navegador del supervisor.
 */
export function minutesSince(
  iso: string | null | undefined,
  nowIso: string | null | undefined,
): number | null {
  if (!iso) return null;
  const from = new Date(iso).getTime();
  const to = nowIso ? new Date(nowIso).getTime() : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.floor((to - from) / 60000));
}
