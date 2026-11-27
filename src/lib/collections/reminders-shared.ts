// ============================================================
// Recordatorios preventivos por cuota — piezas puras (migración 134).
//
// Este archivo lo importan tanto el servidor como la pantalla de
// Configuración, así que NO puede tocar red, Supabase ni claves de
// servicio. La ejecución vive en `reminders.ts`.
// ============================================================

import { formatDate, formatUsd } from "./format";

// ------------------------------------------------------------
// 1. Tipos
// ------------------------------------------------------------

export type ReminderKind = "before_due" | "on_due" | "after_due";
export type ReminderChannel = "whatsapp" | "email";

export interface ReminderSettings {
  account_id: string;
  enabled: boolean;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  whatsapp_template: string | null;
  email_subject: string;
  email_body: string;
  days_before: number;
  days_after: number;
  send_hour: number;
  max_per_run: number;
  last_run_at: string | null;
  last_run_summary: ReminderRunSummary | null;
  created_at?: string;
  updated_at?: string;
}

export interface ReminderCandidate {
  installment_id: string;
  credit_id: string;
  debtor_id: string;
  debtor_name: string;
  phone: string | null;
  email: string | null;
  installment_number: number;
  due_date: string;
  /** due_date − fecha local de la corrida (positivo = aún no vence). */
  days_delta: number;
  kind: ReminderKind;
  balance: number | string;
  currency: string;
  business_name: string;
  whatsapp_sent: boolean;
  email_sent: boolean;
}

export type ReminderItemStatus = "preview" | "sent" | "failed" | "skipped";

export interface ReminderRunItem {
  installment_id: string;
  debtor_name: string;
  kind: ReminderKind;
  channel: ReminderChannel;
  status: ReminderItemStatus;
  reason?: string | null;
  external_id?: string | null;
  /** Texto que se enviaría (solo en simulación). */
  preview?: string | null;
}

export interface ReminderRunSummary {
  date: string;
  dry_run: boolean;
  candidates: number;
  sent: number;
  failed: number;
  skipped: number;
  items: ReminderRunItem[];
  /** Motivos agregados, para pintar el resumen sin abrir cada fila. */
  reasons: Record<string, number>;
  ran_at: string;
}

// ------------------------------------------------------------
// 2. Valores por defecto y textos de ayuda
// ------------------------------------------------------------

export const DEFAULT_EMAIL_SUBJECT = "Recordatorio de pago · {{negocio}}";
export const DEFAULT_EMAIL_BODY = [
  "Hola {{deudor}}:",
  "",
  "Te recordamos que tu cuota {{cuota}} de {{negocio}} por {{monto}} vence el {{vencimiento}}.",
  "{{estado}}",
  "",
  "Si ya realizaste el pago, puedes ignorar este mensaje.",
  "",
  "Gracias,",
  "{{negocio}}",
].join("\n");

export const EMAIL_PLACEHOLDERS = [
  { token: "{{deudor}}", label: "Nombre del deudor" },
  { token: "{{negocio}}", label: "Nombre del negocio" },
  { token: "{{cuota}}", label: "Número de cuota" },
  { token: "{{monto}}", label: "Saldo de la cuota" },
  { token: "{{vencimiento}}", label: "Fecha de vencimiento" },
  { token: "{{estado}}", label: "Faltan / vence hoy / mora" },
  { token: "{{enlace}}", label: "Enlace de pago del deudor" },
] as const;

/**
 * Orden oficial de las variables de la plantilla de WhatsApp:
 *   {{1}} deudor · {{2}} negocio · {{3}} monto · {{4}} vencimiento
 *   {{5}} enlace de pago
 */
export const WHATSAPP_VARIABLE_HELP =
  "{{1}} deudor · {{2}} negocio · {{3}} monto · {{4}} vencimiento · {{5}} enlace de pago";

export function defaultReminderSettings(accountId: string): ReminderSettings {
  return {
    account_id: accountId,
    enabled: false,
    whatsapp_enabled: true,
    email_enabled: false,
    whatsapp_template: null,
    email_subject: DEFAULT_EMAIL_SUBJECT,
    email_body: DEFAULT_EMAIL_BODY,
    days_before: 3,
    days_after: 5,
    send_hour: 9,
    max_per_run: 200,
    last_run_at: null,
    last_run_summary: null,
  };
}

// ------------------------------------------------------------
// 3. Fechas y horas locales del negocio
// ------------------------------------------------------------

export function safeTimezone(timeZone: string | null | undefined): string {
  const candidate = timeZone?.trim();
  if (!candidate) return "America/Caracas";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "America/Caracas";
  }
}

/** Fecha YYYY-MM-DD en la zona del negocio (fallback Caracas). */
export function localDateInZone(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimezone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Hora 0–23 en la zona del negocio (fallback Caracas). */
export function localHourInZone(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone(timeZone),
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = parts.find((part) => part.type === "hour")?.value;
  return Number(value ?? 0);
}

// ------------------------------------------------------------
// 4. Regla: qué peldaño corresponde
// ------------------------------------------------------------

export function reminderKindFor(
  daysDelta: number,
  daysBefore: number,
  daysAfter: number,
): ReminderKind | null {
  if (daysDelta === daysBefore) return "before_due";
  if (daysDelta === 0) return "on_due";
  if (daysDelta === -daysAfter) return "after_due";
  return null;
}

export function reminderKindLabel(
  kind: ReminderKind,
  settings?: Pick<ReminderSettings, "days_before" | "days_after">,
): string {
  const before = settings?.days_before ?? 3;
  const after = settings?.days_after ?? 5;
  switch (kind) {
    case "before_due":
      return `Antes del vencimiento (${before} día${before === 1 ? "" : "s"})`;
    case "on_due":
      return "Día del vencimiento";
    case "after_due":
      return `Después del vencimiento (${after} día${after === 1 ? "" : "s"})`;
  }
}

/** "Faltan 3 días…" / "La cuota vence hoy." / "Tiene 5 días de mora." */
export function reminderStateText(candidate: { days_delta: number }): string {
  const delta = Number(candidate.days_delta) || 0;
  if (delta > 0) {
    return `${delta === 1 ? "Falta" : "Faltan"} ${delta} día${delta === 1 ? "" : "s"} para el vencimiento.`;
  }
  if (delta === 0) return "La cuota vence hoy.";
  const days = Math.abs(delta);
  return `La cuota tiene ${days} día${days === 1 ? "" : "s"} de mora.`;
}

// ------------------------------------------------------------
// 5. Mensajes
// ------------------------------------------------------------

export function reminderValues(
  candidate: ReminderCandidate,
  paymentLink?: string | null,
): Record<string, string> {
  const amount = formatUsd(Number(candidate.balance) || 0);
  const due = formatDate(candidate.due_date);
  const days = Math.abs(Number(candidate.days_delta) || 0);
  const values: Record<string, string> = {
    deudor: candidate.debtor_name,
    nombre: candidate.debtor_name,
    negocio: candidate.business_name,
    cuota: String(candidate.installment_number),
    monto: amount,
    saldo: amount,
    vencimiento: due,
    fecha: due,
    dias: String(days),
    estado: reminderStateText(candidate),
  };
  if (paymentLink) {
    values.enlace = paymentLink;
    values.link = paymentLink;
    values.url = paymentLink;
  }
  return values;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

/** Reemplaza marcadores conocidos; deja intactos los que no conoce. */
export function renderReminderText(
  template: string,
  candidate: ReminderCandidate,
  paymentLink?: string | null,
): string {
  const values = reminderValues(candidate, paymentLink);
  return template.replace(PLACEHOLDER_RE, (marker, raw: string) => {
    const key = raw.toLowerCase();
    return values[key] ?? marker;
  });
}

/** Variables posicionales para la plantilla de WhatsApp. */
export function whatsappValues(
  candidate: ReminderCandidate,
  paymentLink?: string | null,
): string[] {
  return [
    candidate.debtor_name,
    candidate.business_name,
    formatUsd(Number(candidate.balance) || 0),
    formatDate(candidate.due_date),
    paymentLink ?? "",
  ];
}

/** ¿La plantilla numérica pide el enlace de pago ({{5}})? */
export function templateNeedsPaymentLink(template: string): boolean {
  return /\{\{\s*5\s*\}\}/.test(template);
}

/** ¿El texto (correo) usa el enlace de pago? */
export function textNeedsPaymentLink(text: string): boolean {
  return /\{\{\s*(enlace|link|url)\s*\}\}/i.test(text);
}

export type WhatsappParamsResult =
  | { ok: true; params: string[] }
  | { ok: false; error: string };

/**
 * Ajusta las variables al número que pide la plantilla aprobada.
 * Si la plantilla pide más de las cuatro documentadas, no se envía:
 * es mejor no mandar nada que mandar una plantilla incompleta.
 */
export function whatsappParamsFor(
  templateBody: string,
  candidate: ReminderCandidate,
  paymentLink?: string | null,
): WhatsappParamsResult {
  const indices = new Set<number>();
  for (const match of templateBody.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    indices.add(Number(match[1]));
  }
  const needed = indices.size > 0 ? Math.max(...indices) : 0;

  // Meta exige variables secuenciales: {{1}}, {{2}}, {{3}}… sin saltos.
  for (let index = 1; index <= needed; index += 1) {
    if (!indices.has(index)) {
      return {
        ok: false,
        error: `La plantilla usa {{${needed}}} sin {{${index}}}. Meta exige variables secuenciales desde {{1}}.`,
      };
    }
  }

  const values = whatsappValues(candidate, paymentLink);
  if (needed > values.length) {
    return {
      ok: false,
      error: `La plantilla pide ${needed} variables y el recordatorio solo llena ${values.length} (${WHATSAPP_VARIABLE_HELP}).`,
    };
  }
  if (needed >= 5 && !paymentLink) {
    return {
      ok: false,
      error:
        "La plantilla pide {{5}} (enlace de pago) y todavía no hay enlace para este deudor. Se creará al enviar; configura NEXT_PUBLIC_SITE_URL si el envío automático lo necesita.",
    };
  }
  return { ok: true, params: values.slice(0, needed) };
}

export function renderWhatsappPreview(
  body: string,
  params: string[],
): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (marker, raw) => {
    const value = params[Number(raw) - 1];
    return value && value.trim() ? value.trim() : marker;
  });
}

export function emailHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937">${escaped.replace(
    /\n/g,
    "<br />",
  )}</div>`;
}

// ------------------------------------------------------------
// 6. Normalización de la regla
// ------------------------------------------------------------

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function textOr(value: unknown, fallback: string, max = 5000): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, max);
}

export function normalizeReminderSettings(
  input: Partial<ReminderSettings> & { account_id: string },
  existing?: ReminderSettings | null,
): ReminderSettings {
  const base = existing ?? defaultReminderSettings(input.account_id);
  const enabled = Boolean(input.enabled ?? base.enabled);
  const whatsappEnabled = Boolean(
    input.whatsapp_enabled ?? base.whatsapp_enabled,
  );
  const emailEnabled = Boolean(input.email_enabled ?? base.email_enabled);

  const template =
    typeof input.whatsapp_template === "string"
      ? input.whatsapp_template.trim()
      : base.whatsapp_template;

  return {
    account_id: input.account_id,
    enabled,
    // No se puede activar un canal sin su configuración mínima.
    whatsapp_enabled: whatsappEnabled,
    email_enabled: emailEnabled,
    whatsapp_template: template ? template.slice(0, 120) : null,
    email_subject: textOr(
      input.email_subject,
      base.email_subject || DEFAULT_EMAIL_SUBJECT,
      200,
    ),
    email_body: textOr(
      input.email_body,
      base.email_body || DEFAULT_EMAIL_BODY,
      8000,
    ),
    days_before: clampInt(input.days_before, 0, 30, base.days_before),
    days_after: clampInt(input.days_after, 1, 60, base.days_after),
    send_hour: clampInt(input.send_hour, 0, 23, base.send_hour),
    max_per_run: clampInt(input.max_per_run, 1, 2000, base.max_per_run),
    last_run_at: base.last_run_at,
    last_run_summary: base.last_run_summary,
    created_at: base.created_at,
    updated_at: base.updated_at,
  };
}
