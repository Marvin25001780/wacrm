// ============================================================
// WhatsApp de cobranza — lógica pura compartida por la API y la
// consola del agente (migración 127).
//
// Aquí no se habla con Meta ni con Supabase: solo se decide qué se
// puede enviar y cómo se muestra. La regla que más importa es la
// ventana de servicio de 24 h: fuera de ella, Meta rechaza el texto
// libre (error 131047) y el mensaje tiene que salir como plantilla
// aprobada. La consola lo avisa antes de intentar el envío.
// ============================================================

export interface CollectionWhatsappTarget {
  debtor_id: string;
  account_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  display_name: string;
  phone: string | null;
  phone_e164: string | null;
  country: string;
  whatsapp_configured: boolean;
  whatsapp_connected: boolean;
  last_message_at: string | null;
  last_message_text: string | null;
  last_message_sender: string | null;
  unread_count: number;
}

export type WhatsappSender = "customer" | "agent" | "bot";

export interface CollectionWhatsappMessage {
  message_id: string;
  sender_type: WhatsappSender;
  content_type: string;
  content_text: string | null;
  media_url: string | null;
  template_name: string | null;
  status: string;
  created_at: string;
}

export interface CollectionWhatsappTemplate {
  id: string;
  name: string;
  language: string | null;
  category: string;
  header_type: string | null;
  header_content: string | null;
  body_text: string;
  status: string;
}

export const WHATSAPP_WINDOW_HOURS = 24;
export const WHATSAPP_TEXT_LIMIT = 4096;

const VARIABLE_RE = /\{\{\s*(\d+)\s*\}\}/g;

/** Último mensaje entrante del deudor (el que abre la ventana de 24 h). */
export function lastInboundAt(
  messages: readonly CollectionWhatsappMessage[]
): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const message of messages) {
    if (message.sender_type !== "customer") continue;
    const ms = Date.parse(message.created_at);
    if (Number.isNaN(ms) || ms <= latestMs) continue;
    latestMs = ms;
    latest = message.created_at;
  }
  return latest;
}

export interface ServiceWindow {
  open: boolean;
  remainingMinutes: number;
  expiresAt: string | null;
}

/**
 * Ventana de atención al cliente de Meta: se puede responder con
 * texto libre durante las 24 h siguientes al último mensaje del
 * deudor. Sin mensaje entrante no hay ventana: el primer contacto
 * siempre debe ser plantilla.
 */
export function serviceWindow(
  messages: readonly CollectionWhatsappMessage[],
  nowMs: number = Date.now()
): ServiceWindow {
  const inbound = lastInboundAt(messages);
  if (!inbound) {
    return { open: false, remainingMinutes: 0, expiresAt: null };
  }
  const expiresMs =
    Date.parse(inbound) + WHATSAPP_WINDOW_HOURS * 60 * 60 * 1000;
  const remaining = expiresMs - nowMs;
  return {
    open: remaining > 0,
    remainingMinutes: Math.max(0, Math.ceil(remaining / 60000)),
    expiresAt: new Date(expiresMs).toISOString(),
  };
}

/** "Quedan 5 h 12 min" / "Ventana cerrada". */
export function formatWindowLeft(window: ServiceWindow): string {
  if (!window.open) return "Ventana cerrada";
  if (window.remainingMinutes < 60) {
    return `Quedan ${window.remainingMinutes} min`;
  }
  const hours = Math.floor(window.remainingMinutes / 60);
  const minutes = window.remainingMinutes % 60;
  return minutes === 0
    ? `Quedan ${hours} h`
    : `Quedan ${hours} h ${minutes} min`;
}

/** Cantidad de variables {{n}} del cuerpo, contando la más alta. */
export function templateVariableCount(body: string): number {
  let max = 0;
  for (const match of body.matchAll(VARIABLE_RE)) {
    const index = Number(match[1]);
    if (Number.isFinite(index) && index > max) max = index;
  }
  return max;
}

/** Reemplaza {{1}}, {{2}}… por los valores; deja el marcador si falta. */
export function fillTemplatePreview(
  body: string,
  values: readonly string[]
): string {
  return body.replace(VARIABLE_RE, (marker, raw) => {
    const index = Number(raw);
    const value = values[index - 1];
    return value && value.trim() ? value.trim() : marker;
  });
}

/**
 * La v1 del panel solo envía plantillas cuyo encabezado no pide
 * variables (el envío pide un valor de header aparte y no queremos
 * un formulario a medias). Las de encabezado fijo, imagen o video
 * sí se pueden enviar tal cual.
 */
export function templateSupportsSimpleSend(
  template: CollectionWhatsappTemplate
): boolean {
  if (template.header_type !== "text") return true;
  return !/\{\{\s*\d+\s*\}\}/.test(template.header_content ?? "");
}

const STATUS_LABELS: Record<string, string> = {
  sending: "Enviando",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló",
};

export function messageStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const CONTENT_LABELS: Record<string, string> = {
  image: "Imagen",
  video: "Video",
  audio: "Audio",
  document: "Documento",
  location: "Ubicación",
  template: "Plantilla",
};

/** Texto visible de un mensaje que no es de texto (sin inventar contenido). */
export function messagePreview(message: CollectionWhatsappMessage): string {
  const text = message.content_text?.trim();
  if (text) return text;
  if (message.template_name) return `Plantilla: ${message.template_name}`;
  return CONTENT_LABELS[message.content_type] ?? message.content_type;
}

/** ¿Se puede abrir el compositor de texto libre ahora mismo? */
export function canSendFreeText(
  target: CollectionWhatsappTarget | null,
  window: ServiceWindow
): boolean {
  return Boolean(target?.whatsapp_configured && target.phone_e164 && window.open);
}
