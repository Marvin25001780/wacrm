// ============================================================
// OCR de comprobantes (bloque 136).
//
// Lee la foto de una transferencia, pago móvil o depósito con el
// proveedor de IA que el negocio ya configuró. No aprueba nada: la
// salida se convierte en un comprobante `pending` para revisión.
//
// Proveedores con visión:
//   - OpenAI    (chat/completions + image_url)
//   - Gemini    (generateContent + inlineData)
//   - Anthropic (messages + image base64)
//   - Groq      (chat/completions compatible con OpenAI)
//
// DeepSeek no expone imágenes: se devuelve un error explicable y la
// captura se omite, sin inventar datos.
// ============================================================

import {
  isUsdOrUnknown,
  normalizeOcrCurrency,
  normalizeReceiptBank,
  normalizeReceiptDate,
  normalizeReceiptReference,
  parseReceiptAmount,
  type OcrCurrency,
} from "./receipt-capture-shared";

export type VisionProvider = "openai" | "gemini" | "anthropic" | "groq";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

const DEFAULT_MODELS: Record<VisionProvider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
  anthropic: "claude-3-5-sonnet-latest",
  groq: "meta-llama/llama-4-scout-17b-16e-instruct",
};

const OCR_TIMEOUT_MS = 35_000;
/** OpenAI acepta hasta 20 MB por imagen; nos quedamos por debajo. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const OCR_PROMPT = `Eres un extractor de comprobantes de pago de Venezuela y del mundo.
Analiza la imagen y devuelve SOLO un objeto JSON, sin markdown, con esta forma exacta:
{
  "is_receipt": true,
  "amount": 0,
  "currency": "USD",
  "reference": null,
  "bank": null,
  "paid_at": null,
  "confidence": 0,
  "notes": null
}

Reglas:
- is_receipt = true SOLO si la imagen es un comprobante de pago legible (transferencia, pago móvil, depósito, Zelle, etc.). Si es otra cosa (conversación, foto personal, captura sin datos de pago), usa false.
- amount: monto total pagado, como número sin símbolos ni separadores de miles. Si dice "1.234,56" devuelve 1234.56. Si no se lee, null.
- currency: "USD" si el comprobante dice dólares/USD/$; "VES" si dice bolívares/Bs./VES. Si no se distingue, null.
- reference: número de referencia, confirmación, operación o comprobante. Si no se lee, null. No inventes dígitos.
- bank: banco o entidad emisora (ej. Banesco, Mercantil, Zelle). Si no se lee, null.
- paid_at: fecha del pago en formato YYYY-MM-DD. Si no se lee, null.
- confidence: número entre 0 y 1 con tu seguridad sobre monto y referencia.
- notes: cualquier dato útil que no encaje (titular, cuenta destino, hora). Si no hay, null.

Nunca inventes un monto ni una referencia. Es mejor null que un dato falso.`;

export interface ReceiptOcrConfig {
  provider: string;
  model?: string | null;
  apiKey: string;
}

export interface ReceiptOcrResult {
  isReceipt: boolean;
  amount: number | null;
  currency: OcrCurrency | null;
  reference: string | null;
  bank: string | null;
  paidAt: string | null;
  confidence: number | null;
  notes: string | null;
  raw: Record<string, unknown>;
}

export class ReceiptOcrError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "ocr_failed", status = 502) {
    super(message);
    this.name = "ReceiptOcrError";
    this.code = code;
    this.status = status;
  }
}

/** Proveedor con visión; null si el configurado no lee imágenes. */
export function visionProvider(provider: string): VisionProvider | null {
  if (
    provider === "openai" ||
    provider === "gemini" ||
    provider === "anthropic" ||
    provider === "groq"
  ) {
    return provider;
  }
  return null;
}

export function visionProviderLabel(provider: string): string | null {
  const resolved = visionProvider(provider);
  if (!resolved) return null;
  return {
    openai: "OpenAI",
    gemini: "Gemini",
    anthropic: "Anthropic",
    groq: "Groq",
  }[resolved];
}

/** Convierte la respuesta cruda del modelo en datos verificables. */
export function parseReceiptOcrJson(raw: string): ReceiptOcrResult {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ReceiptOcrError(
      "El OCR no devolvió un objeto JSON.",
      "invalid_response",
      502,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new ReceiptOcrError(
      "El OCR devolvió un JSON inválido.",
      "invalid_response",
      502,
    );
  }

  const isReceipt =
    parsed.is_receipt === true ||
    (typeof parsed.is_receipt === "string" &&
      parsed.is_receipt.trim().toLowerCase() === "true");

  return {
    isReceipt,
    amount: parseReceiptAmount(parsed.amount),
    currency: normalizeOcrCurrency(parsed.currency),
    reference: normalizeReceiptReference(parsed.reference),
    bank: normalizeReceiptBank(parsed.bank),
    paidAt: normalizeReceiptDate(parsed.paid_at),
    confidence: normalizeConfidence(parsed.confidence),
    notes: normalizeReceiptReference(parsed.notes),
    raw: parsed,
  };
}

function normalizeConfidence(value: unknown): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return null;
  const scaled = number > 1 && number <= 100 ? number / 100 : number;
  return Math.min(Math.max(scaled, 0), 1);
}

export interface OcrReceiptArgs {
  config: ReceiptOcrConfig;
  buffer: Buffer;
  mimeType: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Ejecuta el OCR. Lanza `ReceiptOcrError` con un motivo legible: el
 * llamador decide si lo registra o lo muestra en diagnóstico.
 */
export async function ocrReceipt(args: OcrReceiptArgs): Promise<ReceiptOcrResult> {
  const { config, buffer, mimeType } = args;

  const provider = visionProvider(config.provider);
  if (!provider) {
    throw new ReceiptOcrError(
      `El proveedor ${config.provider} no lee imágenes. Configura OpenAI, Gemini, Anthropic o Groq en Ajustes → Asistente de IA.`,
      "provider_without_vision",
      400,
    );
  }

  if (!mimeType.toLowerCase().startsWith("image/")) {
    throw new ReceiptOcrError(
      "Solo se pueden leer comprobantes en imagen (JPG, PNG o WEBP).",
      "unsupported_mime",
      400,
    );
  }

  if (buffer.byteLength === 0) {
    throw new ReceiptOcrError("La imagen está vacía.", "empty_media", 400);
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new ReceiptOcrError(
      "La imagen supera los 12 MB y no se puede leer.",
      "media_too_large",
      413,
    );
  }

  const configuredModel = config.model?.trim() || null;
  const defaultModel = DEFAULT_MODELS[provider];
  const models =
    configuredModel && configuredModel !== defaultModel
      ? [configuredModel, defaultModel]
      : [defaultModel];

  let lastError: unknown = null;
  for (const model of models) {
    try {
      const text = await callProvider({
        provider,
        apiKey: config.apiKey,
        model,
        buffer,
        mimeType,
        fetchImpl: args.fetchImpl ?? fetch,
        timeoutMs: args.timeoutMs ?? OCR_TIMEOUT_MS,
      });
      return parseReceiptOcrJson(text);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof ReceiptOcrError &&
        (error.status === 400 || error.status === 404) &&
        model !== models[models.length - 1];
      if (!retryable) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ReceiptOcrError("No se pudo leer el comprobante.");
}

interface ProviderCallArgs {
  provider: VisionProvider;
  apiKey: string;
  model: string;
  buffer: Buffer;
  mimeType: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

async function callProvider(args: ProviderCallArgs): Promise<string> {
  if (args.provider === "gemini") return callGemini(args);
  if (args.provider === "anthropic") return callAnthropic(args);
  return callOpenAiCompatible(args);
}

async function fetchJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  providerLabel: string,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new ReceiptOcrError(
      timedOut
        ? `El OCR de ${providerLabel} tardó demasiado.`
        : `No se pudo conectar con ${providerLabel}.`,
      timedOut ? "ocr_timeout" : "ocr_unreachable",
      timedOut ? 504 : 502,
    );
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text().catch(() => "");
  if (!response.ok) {
    throw new ReceiptOcrError(
      `${providerLabel} rechazó la imagen (${response.status}): ${raw.slice(0, 300)}`,
      "ocr_rejected",
      response.status,
    );
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ReceiptOcrError(
      `${providerLabel} devolvió una respuesta inválida.`,
      "invalid_response",
      502,
    );
  }
}

async function callOpenAiCompatible(args: ProviderCallArgs): Promise<string> {
  const { provider, apiKey, model, buffer, mimeType, fetchImpl, timeoutMs } =
    args;
  const url = provider === "groq" ? GROQ_URL : OPENAI_URL;
  const label = provider === "groq" ? "Groq" : "OpenAI";

  const body = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: OCR_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Lee este comprobante y devuelve el JSON pedido.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${buffer.toString("base64")}`,
            },
          },
        ],
      },
    ],
  };

  const parsed = await fetchJson(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    fetchImpl,
    timeoutMs,
    label,
  );

  const choices = parsed.choices as
    | Array<{ message?: { content?: unknown } }>
    | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join(" ")
      .trim();
    if (text) return text;
  }

  throw new ReceiptOcrError(
    `${label} no devolvió texto para la imagen.`,
    "empty_response",
    502,
  );
}

async function callGemini(args: ProviderCallArgs): Promise<string> {
  const { apiKey, model, buffer, mimeType, fetchImpl, timeoutMs } = args;
  const bareModel = model.replace(/^models\//, "");

  const parsed = await fetchJson(
    `${GEMINI_BASE_URL}/${encodeURIComponent(bareModel)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: OCR_PROMPT },
              {
                inlineData: {
                  mimeType,
                  data: buffer.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    },
    fetchImpl,
    timeoutMs,
    "Gemini",
  );

  const candidates = parsed.candidates as
    | Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }>
    | undefined;
  const text = (candidates?.[0]?.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text as string)
    .join(" ")
    .trim();

  if (text) return text;
  throw new ReceiptOcrError(
    "Gemini no devolvió texto para la imagen.",
    "empty_response",
    502,
  );
}

async function callAnthropic(args: ProviderCallArgs): Promise<string> {
  const { apiKey, model, buffer, mimeType, fetchImpl, timeoutMs } = args;

  const parsed = await fetchJson(
    ANTHROPIC_URL,
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0,
        system: OCR_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: buffer.toString("base64"),
                },
              },
              {
                type: "text",
                text: "Lee este comprobante y devuelve el JSON pedido.",
              },
            ],
          },
        ],
      }),
    },
    fetchImpl,
    timeoutMs,
    "Anthropic",
  );

  const content = parsed.content as
    | Array<{ type?: string; text?: unknown }>
    | undefined;
  const text = (content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join(" ")
    .trim();

  if (text) return text;
  throw new ReceiptOcrError(
    "Anthropic no devolvió texto para la imagen.",
    "empty_response",
    502,
  );
}

/** Solo comprobantes en USD (o moneda no identificada) se capturan solos. */
export function canCaptureCurrency(currency: OcrCurrency | null): boolean {
  return isUsdOrUnknown(currency);
}
