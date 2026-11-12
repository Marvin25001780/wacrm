// ============================================================
// Cliente de Mailflare para el módulo Correo.
//
// Mailflare es un servidor de correo autoalojado (Cloudflare Workers o
// Docker). El CRM NO copia su código (es AGPL-3.0): habla con su API.
//
//   * API v1 REST — listar mensajes y enviar correo.
//       GET  /api/v1/messages?limit=&q=&direction=&mailboxId=
//       POST /api/v1/send
//   * JMAP (RFC 8620/8621) — sesión, buzones, identidades y marcar
//     un mensaje como leído.
//       GET  {base}/.well-known/jmap
//       POST {base}/jmap/api
//
// La API key viaja como `Authorization: Bearer <key>` en ambos casos.
// Se guarda cifrada en `email_config` y sólo se descifra en el servidor.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/whatsapp/encryption";

export class MailflareError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "MailflareError";
    this.status = status;
  }
}

export class EmailNotConfiguredError extends Error {
  constructor(message = "El correo no está configurado en esta cuenta.") {
    super(message);
    this.name = "EmailNotConfiguredError";
  }
}

// ------------------------------------------------------------
// Configuración por cuenta
// ------------------------------------------------------------

export interface EmailConfigRow {
  base_url: string;
  api_key: string | null;
  from_name: string | null;
  from_address: string | null;
  mailbox_id: string | null;
  signature: string | null;
  enabled: boolean;
}

export interface MailflareConfig {
  baseUrl: string;
  apiKey: string;
  fromName: string | null;
  fromAddress: string | null;
  mailboxId: string | null;
  signature: string | null;
}

/** Quita barras finales para poder concatenar rutas sin duplicarlas. */
export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Lee la configuración de correo de la cuenta y descifra la API key.
 * Devuelve `null` si no hay fila, está deshabilitada o le falta la key.
 * Lanza `MailflareError` si la key guardada no se puede descifrar (p. ej.
 * tras rotar `ENCRYPTION_KEY`), para que Ajustes pida reingresarla.
 */
export async function loadMailflareConfig(
  supabase: SupabaseClient,
  accountId: string,
): Promise<MailflareConfig | null> {
  const { data, error } = await supabase
    .from("email_config")
    .select(
      "base_url, api_key, from_name, from_address, mailbox_id, signature, enabled",
    )
    .eq("account_id", accountId)
    .maybeSingle<EmailConfigRow>();

  if (error) {
    // La tabla aún no existe en un entorno sin la migración 107: se trata
    // como "sin configurar" para que Ajustes pueda mostrarlo, no como 500.
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    throw new MailflareError("No se pudo leer la configuración de correo.", 500);
  }
  if (!data || !data.enabled || !data.api_key) return null;

  let apiKey: string;
  try {
    apiKey = decrypt(data.api_key);
  } catch {
    throw new MailflareError(
      "La clave de Mailflare no se pudo descifrar. Vuelve a ingresarla en Ajustes → Correo.",
      400,
    );
  }

  return {
    baseUrl: normalizeBaseUrl(data.base_url),
    apiKey,
    fromName: data.from_name,
    fromAddress: data.from_address,
    mailboxId: data.mailbox_id,
    signature: data.signature,
  };
}

// ------------------------------------------------------------
// Transporte
// ------------------------------------------------------------

async function request(
  config: MailflareConfig,
  path: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = /^https?:\/\//i.test(path) ? path : `${config.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MailflareError("Mailflare tardó demasiado en responder.", 504);
    }
    throw new MailflareError(
      "No se pudo contactar a Mailflare. Revisa la URL del servidor.",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
    if (typeof body.message === "string" && body.message.trim()) return body.message;
  } catch {
    // Respuesta sin JSON (proxy, Cloudflare, HTML de error).
  }
  if (res.status === 401) return "Mailflare rechazó la API key.";
  if (res.status === 403) return "La API key no tiene permiso para esta acción.";
  if (res.status === 404) return "Mailflare no encontró el recurso solicitado.";
  return `Mailflare respondió ${res.status}.`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new MailflareError(await readError(res), res.status);
  return (await res.json()) as T;
}

// ------------------------------------------------------------
// API v1 — mensajes y envío
// ------------------------------------------------------------

/** Fila cruda que devuelve `/api/v1/messages` (columnas de `messages`). */
interface MailflareMessageRow {
  id: string;
  mailboxId?: string | null;
  direction?: string | null;
  fromAddr?: string | null;
  toAddr?: string | null;
  ccAddr?: string | null;
  bccAddr?: string | null;
  replyTo?: string | null;
  subject?: string | null;
  snippet?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  status?: string | null;
  read?: boolean | null;
  starred?: boolean | null;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  providerMessageId?: string | null;
  createdAt?: string | null;
}

/** Forma pública que consume el módulo Correo. Nada de campos internos. */
export interface EmailMessage {
  id: string;
  mailboxId: string | null;
  direction: "inbound" | "outbound";
  fromAddr: string | null;
  toAddr: string | null;
  ccAddr: string | null;
  bccAddr: string | null;
  replyTo: string | null;
  subject: string | null;
  snippet: string | null;
  textBody: string | null;
  htmlBody: string | null;
  read: boolean;
  starred: boolean;
  status: string | null;
  threadId: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  createdAt: string | null;
}

function toEmailMessage(row: MailflareMessageRow): EmailMessage {
  return {
    id: row.id,
    mailboxId: row.mailboxId ?? null,
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    fromAddr: row.fromAddr ?? null,
    toAddr: row.toAddr ?? null,
    ccAddr: row.ccAddr ?? null,
    bccAddr: row.bccAddr ?? null,
    replyTo: row.replyTo ?? null,
    subject: row.subject ?? null,
    snippet: row.snippet ?? null,
    textBody: row.textBody ?? null,
    htmlBody: row.htmlBody ?? null,
    read: row.read === true,
    starred: row.starred === true,
    status: row.status ?? null,
    threadId: row.threadId ?? null,
    messageId: row.providerMessageId ?? null,
    inReplyTo: row.inReplyTo ?? null,
    references: row.references ?? null,
    createdAt: row.createdAt ?? null,
  };
}

export interface ListMessagesParams {
  mailboxId?: string | null;
  direction?: "inbound" | "outbound" | null;
  query?: string | null;
  limit?: number;
}

export async function listMessages(
  config: MailflareConfig,
  params: ListMessagesParams = {},
): Promise<EmailMessage[]> {
  const search = new URLSearchParams();
  search.set("limit", String(Math.min(Math.max(params.limit ?? 50, 1), 100)));
  if (params.mailboxId) search.set("mailboxId", params.mailboxId);
  if (params.direction) search.set("direction", params.direction);
  if (params.query?.trim()) search.set("q", params.query.trim());

  const res = await request(config, `/api/v1/messages?${search.toString()}`);
  const data = await json<{ messages?: MailflareMessageRow[] }>(res);
  return (data.messages ?? []).map(toEmailMessage);
}

export interface SendEmailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string | null;
  mailboxId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}

export interface SendEmailResult {
  success: boolean;
  id?: string | null;
}

/**
 * Envía un correo con `/api/v1/send`. Requiere `from` y `mailboxId`; si la
 * configuración no los trae, se resuelven con la primera identidad
 * utilizable de JMAP (ver `resolveSender`).
 */
export async function sendEmail(
  config: MailflareConfig,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const sender = await resolveSender(config, input);
  const body: Record<string, unknown> = {
    from: sender.from,
    to: input.to,
    subject: input.subject,
    mailboxId: sender.mailboxId,
  };
  if (input.cc?.length) body.cc = input.cc;
  if (input.bcc?.length) body.bcc = input.bcc;
  if (input.text) body.text = input.text;
  if (input.html) body.html = input.html;
  if (input.inReplyTo) body.inReplyTo = input.inReplyTo;
  if (input.references) body.references = input.references;

  const res = await request(config, "/api/v1/send", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return json<SendEmailResult>(res);
}

/** Remitente: preferencias de Ajustes y, si faltan, la primera identidad. */
async function resolveSender(
  config: MailflareConfig,
  input: SendEmailInput,
): Promise<{ from: string; mailboxId: string }> {
  const explicitFrom = input.from?.trim() || config.fromAddress?.trim() || "";
  let mailboxId = input.mailboxId?.trim() || config.mailboxId?.trim() || "";

  if (explicitFrom && mailboxId) return { from: explicitFrom, mailboxId };

  const identities = await listIdentities(config).catch(() => []);
  const match = identities.find(
    (identity) =>
      !explicitFrom || identity.email.toLowerCase() === explicitFrom.toLowerCase(),
  );
  const identity = match ?? identities[0];

  if (!explicitFrom && !identity) {
    throw new MailflareError(
      "No hay una dirección de envío configurada. Elige un buzón en Ajustes → Correo.",
      400,
    );
  }
  if (!mailboxId && identity) mailboxId = identity.mailboxId;

  return { from: explicitFrom || identity!.email, mailboxId };
}

// ------------------------------------------------------------
// JMAP — sesión, buzones, identidades y marcas
// ------------------------------------------------------------

export interface JmapSession {
  apiUrl: string;
  accountId: string;
  username?: string;
}

interface JmapResponse {
  methodResponses?: Array<[string, Record<string, unknown>, string]>;
}

const jmapSessionCache = new Map<
  string,
  { at: number; session: JmapSession }
>();
const JMAP_CACHE_TTL = 5 * 60 * 1000;

export async function getJmapSession(
  config: MailflareConfig,
  forceRefresh = false,
): Promise<JmapSession> {
  const cacheKey = `${config.baseUrl}|${config.apiKey.slice(-12)}`;
  const cached = jmapSessionCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.at < JMAP_CACHE_TTL) {
    return cached.session;
  }

  const res = await request(config, "/.well-known/jmap");
  const data = await json<{
    apiUrl?: string;
    username?: string;
    accounts?: Record<string, unknown>;
  }>(res);

  if (!data.apiUrl) {
    throw new MailflareError("Mailflare no devolvió una sesión JMAP válida.", 502);
  }
  // Mailflare usa el id del usuario dueño de la key como `accountId`.
  const accountId =
    Object.keys(data.accounts ?? {})[0] ??
    data.username ??
    "";

  const session: JmapSession = { apiUrl: data.apiUrl, accountId, username: data.username };
  jmapSessionCache.set(cacheKey, { at: Date.now(), session });
  return session;
}

async function jmapCall(
  config: MailflareConfig,
  methodCalls: Array<[string, Record<string, unknown>, string]>,
): Promise<Record<string, unknown>> {
  const session = await getJmapSession(config);
  const res = await request(config, session.apiUrl, {
    method: "POST",
    body: JSON.stringify({
      using: [
        "urn:ietf:params:jmap:core",
        "urn:ietf:params:jmap:mail",
        "urn:ietf:params:jmap:submission",
      ],
      methodCalls,
    }),
  });
  const data = await json<JmapResponse>(res);
  const first = data.methodResponses?.[0];
  if (!first) throw new MailflareError("JMAP devolvió una respuesta vacía.", 502);
  const [, args] = first;
  if (typeof args.type === "string" && args.type !== "Mailbox" && args.type !== "Identity") {
    throw new MailflareError(
      `JMAP rechazó la operación (${args.type}).`,
      502,
    );
  }
  return args;
}

export interface EmailMailbox {
  id: string;
  name: string;
  role: string | null;
  parentId: string | null;
  totalEmails: number;
  unreadEmails: number;
  /** `mailboxId` de Mailflare (prefijo del id JMAP) para enviar. */
  mailboxId: string;
}

interface JmapMailboxRow {
  id: string;
  name?: string;
  role?: string | null;
  parentId?: string | null;
  totalEmails?: number;
  unreadEmails?: number;
}

export async function listMailboxes(config: MailflareConfig): Promise<EmailMailbox[]> {
  const session = await getJmapSession(config);
  if (!session.accountId) return [];
  const args = await jmapCall(config, [
    ["Mailbox/get", { accountId: session.accountId, properties: null }, "0"],
  ]);
  const list = (args.list as JmapMailboxRow[] | undefined) ?? [];
  return list.map((row) => ({
    id: row.id,
    name: row.name ?? row.role ?? "Buzón",
    role: row.role ?? null,
    parentId: row.parentId ?? null,
    totalEmails: Number(row.totalEmails ?? 0),
    unreadEmails: Number(row.unreadEmails ?? 0),
    // Los ids JMAP de Mailflare son `<mailboxId>` o `<mailboxId>~<rol>`.
    mailboxId: row.id.split("~")[0],
  }));
}

export interface EmailIdentity {
  id: string;
  name: string;
  email: string;
  mailboxId: string;
}

interface JmapIdentityRow {
  id: string;
  name?: string;
  email?: string;
}

export async function listIdentities(config: MailflareConfig): Promise<EmailIdentity[]> {
  const session = await getJmapSession(config);
  if (!session.accountId) return [];
  const args = await jmapCall(config, [
    ["Identity/get", { accountId: session.accountId }, "0"],
  ]);
  const list = (args.list as JmapIdentityRow[] | undefined) ?? [];
  return list
    .filter((row) => row.email)
    .map((row) => ({
      id: row.id,
      name: row.name ?? "",
      email: row.email!,
      mailboxId: row.id.split("~")[0],
    }));
}

/**
 * Marca un mensaje como leído (`keywords/$seen`) con `Email/set`.
 * Los ids de correo de Mailflare son los mismos en la API v1 y en JMAP.
 */
export async function markMessageRead(
  config: MailflareConfig,
  messageId: string,
  read = true,
): Promise<void> {
  const session = await getJmapSession(config);
  if (!session.accountId) {
    throw new MailflareError("No hay una cuenta JMAP asociada a la API key.", 400);
  }
  await jmapCall(config, [
    [
      "Email/set",
      {
        accountId: session.accountId,
        update: { [messageId]: { "keywords/$seen": read } },
      },
      "0",
    ],
  ]).then((args) => {
    const notUpdated = args.notUpdated as
      | Record<string, { type?: string; description?: string }>
      | undefined;
    if (notUpdated && Object.keys(notUpdated).length > 0) {
      const failure = Object.values(notUpdated)[0];
      throw new MailflareError(
        failure?.description ||
          "No se pudo actualizar el correo en Mailflare.",
        502,
      );
    }
  });
}

/** Comprueba URL + key contra Mailflare. Devuelve la sesión y los buzones. */
export async function testConnection(config: MailflareConfig): Promise<{
  session: JmapSession;
  mailboxes: EmailMailbox[];
  identities: EmailIdentity[];
}> {
  const session = await getJmapSession(config, true);
  const [mailboxes, identities] = await Promise.all([
    listMailboxes(config),
    listIdentities(config),
  ]);
  return { session, mailboxes, identities };
}
