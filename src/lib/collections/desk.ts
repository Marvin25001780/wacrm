// ============================================================
// Consola de cobranza — lógica pura (migración 125).
//
// Aquí vive lo que se puede probar sin base ni red: el orden de la
// cola, la validación de la tipificación, el guión del tramo y las
// etiquetas de vencimiento. La API y la pantalla solo los usan.
//
// Decisión de diseño: la lista de tipificaciones NO se duplica en
// TypeScript. Se lee de `collection_outcomes` (que el admin puede
// editar) y esta capa valida contra lo que la base ya exige en el
// trigger `collection_validate_action`, pero con mensajes legibles
// antes de intentar el INSERT.
// ============================================================

import type {
  CollectionDebtorStatus,
  CollectionOutcome,
  CollectionSegment,
} from "@/types/collections";
import { validatePromise, type PolicyLike } from "./policies";

// ------------------------------------------------------------
// 1. Cola de trabajo
// ------------------------------------------------------------

export type QueueScope = "mine" | "unassigned" | "all";

export const QUEUE_SCOPES: { value: QueueScope; label: string }[] = [
  { value: "mine", label: "Mis deudores" },
  { value: "unassigned", label: "Sin asignar" },
  { value: "all", label: "Toda la cartera" },
];

export function isQueueScope(value: unknown): value is QueueScope {
  return QUEUE_SCOPES.some((scope) => scope.value === value);
}

/**
 * Grupos de la cola. Se ordenan por urgencia real: primero lo que ya
 * se prometió y no se cumplió, después la mora y al final lo que aún
 * no vence. El número lo calcula el servidor; aquí solo su etiqueta.
 */
export const QUEUE_RANKS: { value: number; label: string; tone: string }[] = [
  {
    value: 0,
    label: "PTP vencida",
    tone: "border-red-500/40 bg-red-500/10 text-red-300",
  },
  {
    value: 1,
    label: "PTP próxima",
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  {
    value: 2,
    label: "En mora",
    tone: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  },
  {
    value: 3,
    label: "Al día",
    tone: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  },
];

export function queueRankLabel(rank: number): string {
  return QUEUE_RANKS.find((item) => item.value === rank)?.label ?? "Sin clasificar";
}

export function queueRankTone(rank: number): string {
  return (
    QUEUE_RANKS.find((item) => item.value === rank)?.tone ??
    "border-border bg-muted text-muted-foreground"
  );
}

export const SEGMENT_LABELS: Record<CollectionSegment, string> = {
  preventiva: "Preventiva",
  temprana: "Temprana",
  media: "Media",
  tardia: "Tardía",
  critica: "Crítica",
};

/** Texto de búsqueda de la cola: recortado y en una sola línea. */
export function normalizeQueueSearch(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 60);
}

// ------------------------------------------------------------
// 2. Tipificación
// ------------------------------------------------------------

export type ActionChannelInput =
  | "call"
  | "whatsapp"
  | "sms"
  | "email"
  | "visit"
  | "other";

export const DEFAULT_ACTION_CHANNEL: ActionChannelInput = "call";

const ACTION_CHANNELS: ActionChannelInput[] = [
  "call",
  "whatsapp",
  "sms",
  "email",
  "visit",
  "other",
];

export function isActionChannel(value: unknown): value is ActionChannelInput {
  return ACTION_CHANNELS.includes(value as ActionChannelInput);
}

export interface ActionInput {
  level1: string;
  level2?: string | null;
  channel: ActionChannelInput;
  notes?: string | null;
  amount?: number | null;
  dueDate?: string | null;
  creditId?: string | null;
}

export interface ActionValidationOptions {
  /** Hoy en formato YYYY-MM-DD (hora de Venezuela). */
  today: string;
  /** Créditos abiertos del deudor, para validar la PTP. */
  credits?: { id: string; balance: number }[];
  /** Política del tramo, si existe. */
  policy?: PolicyLike | null;
}

type OutcomeLike = Pick<
  CollectionOutcome,
  | "code"
  | "level"
  | "parent_code"
  | "requires_amount"
  | "requires_date"
  | "requires_reason"
  | "active"
>;

export const MAX_ACTION_NOTES = 2000;

/**
 * Valida una gestión antes de escribir. Devuelve la lista de errores
 * legibles (vacía = se puede guardar). No consulta la base: recibe el
 * catálogo de tipificaciones ya cargado.
 */
export function validateActionInput(
  input: ActionInput,
  outcomes: OutcomeLike[],
  options: ActionValidationOptions
): string[] {
  const errors: string[] = [];
  const active = outcomes.filter((outcome) => outcome.active);

  const level1 = active.find(
    (outcome) => outcome.level === 1 && outcome.code === input.level1
  );
  if (!level1) {
    errors.push("Elige una tipificación de contacto.");
  }

  const level2Codes = level1
    ? active.filter(
        (outcome) => outcome.level === 2 && outcome.parent_code === level1.code
      )
    : [];
  const level2 = input.level2
    ? level2Codes.find((outcome) => outcome.code === input.level2)
    : null;

  if (level1 && level2Codes.length > 0 && !level2) {
    errors.push("Elige el detalle de la tipificación.");
  }
  if (input.level2 && level1 && level2Codes.length > 0 && !level2) {
    errors.push("Ese detalle no pertenece a la tipificación elegida.");
  }

  if (input.notes && input.notes.length > MAX_ACTION_NOTES) {
    errors.push(`Las notas no pueden pasar de ${MAX_ACTION_NOTES} caracteres.`);
  }

  const effective = [level1, level2].filter(Boolean) as OutcomeLike[];
  const needsAmount = effective.some((outcome) => outcome.requires_amount);
  const needsDate = effective.some((outcome) => outcome.requires_date);
  const needsReason = effective.some((outcome) => outcome.requires_reason);

  if (needsAmount) {
    if (!Number.isFinite(input.amount ?? NaN) || (input.amount ?? 0) <= 0) {
      errors.push("El monto es obligatorio y debe ser mayor que cero.");
    }
  }

  if (needsDate && !input.dueDate) {
    errors.push("La fecha es obligatoria para esta tipificación.");
  }

  if (needsReason && !(input.notes ?? "").trim()) {
    errors.push("Escribe el motivo en las notas.");
  }

  if (level2?.code === "ptp") {
    if (!input.creditId) {
      errors.push("Elige el crédito de la promesa de pago.");
    }
    const credit = options.credits?.find((item) => item.id === input.creditId);
    if (options.credits && input.creditId && !credit) {
      errors.push("El crédito elegido no pertenece a este deudor.");
    }
    if (input.amount && input.dueDate) {
      const policyErrors = options.policy
        ? validatePromise(
            {
              amount: input.amount,
              dueDate: input.dueDate,
              balance: credit?.balance ?? input.amount,
            },
            options.policy,
            options.today
          )
        : input.dueDate < options.today
          ? ["La fecha de la promesa no puede estar en el pasado."]
          : [];
      errors.push(...policyErrors);
    }
  }

  return errors;
}

/**
 * Estados que el agente puede fijar a mano. `pagado` lo deriva el
 * trigger de pagos y `juridico` es decisión de un admin: ninguno de
 * los dos se ofrece como interruptor suelto.
 */
export const AGENT_DEBTOR_STATUSES: CollectionDebtorStatus[] = [
  "contactado",
  "negociacion",
  "acuerdo",
  "ilocalizable",
];

export const ADMIN_DEBTOR_STATUSES: CollectionDebtorStatus[] = [
  ...AGENT_DEBTOR_STATUSES,
  "juridico",
];

export function allowedDebtorStatuses(isAdmin: boolean): CollectionDebtorStatus[] {
  return isAdmin ? ADMIN_DEBTOR_STATUSES : AGENT_DEBTOR_STATUSES;
}

// ------------------------------------------------------------
// 3. Guión y fechas
// ------------------------------------------------------------

/**
 * Sustituye `{{variable}}` en el guión del tramo
 * (`collection_policies.script_template`). Las variables conocidas son
 * nombre, saldo, vencido, mora, fecha y gestor. Un marcador
 * desconocido se deja tal cual para que el admin vea el error de
 * tipeo en vez de un hueco silencioso.
 */
export function renderScript(
  template: string | null | undefined,
  vars: Record<string, string | number | null | undefined>
): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, key: string) => {
    const value = vars[key.toLowerCase()];
    if (value === null || value === undefined || value === "") return match;
    return String(value);
  });
}

/** Texto corto para una fecha comprometida: "Vence en 3 d". */
export function dueLabel(dueDate: string | null | undefined, today: string): string {
  if (!dueDate) return "Sin fecha";
  const days = Math.round((utcDay(dueDate) - utcDay(today)) / 86_400_000);
  if (!Number.isFinite(days)) return "Sin fecha";
  if (days < 0) return `Venció hace ${Math.abs(days)} d`;
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence mañana";
  return `Vence en ${days} d`;
}

function utcDay(value: string): number {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
}

/**
 * Fecha por defecto de una PTP: la menor entre 7 días y el tope de la
 * política del tramo. No inventa una fecha fuera de política.
 */
export function defaultPromiseDue(today: string, maxDays = 7): string {
  const span = Math.max(0, Math.min(7, maxDays));
  return new Date(utcDay(today) + span * 86_400_000).toISOString().slice(0, 10);
}

/** Tramo de mora, igual que `collection_tramo()` en la base. */
export function tramoForDays(days: number): string {
  if (!Number.isFinite(days) || days <= 15) return "1_15";
  if (days <= 30) return "16_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_plus";
}
