// ============================================================
// Captura automática de comprobantes — piezas puras (136).
//
// El OCR y el agente de IA entregan texto libre: montos con puntos de
// miles, referencias con espacios, fechas en DD/MM/AAAA. Estas
// funciones normalizan sin inventar: si un dato no se puede leer,
// devuelven null.
// ============================================================

export type OcrCurrency = "USD" | "VES";

/** Redondeo monetario a dos decimales (centavos). */
function money(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Convierte lo que devuelve un OCR o un modelo a un monto positivo.
 *
 * Acepta `1.234,56` (formato Venezuela), `1,234.56` (formato EE. UU.),
 * `1234.56`, `1234,56`, `USD 50`, `Bs. 1.234,56` y números.
 *
 * Con un solo separador y tres dígitos detrás se interpreta como miles
 * (`1.234` → 1234), porque en Venezuela el decimal siempre es coma y
 * un monto de tres decimales no existe.
 */
export function parseReceiptAmount(value: unknown): number | null {
  if (typeof value === "number") return money(value);
  if (typeof value !== "string") return null;

  const cleaned = value.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === ",") {
    return null;
  }

  const negative = cleaned.startsWith("-");
  const digits = cleaned.replace(/-/g, "");
  if (!/\d/.test(digits)) return null;

  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");

  let normalized: string;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSeparator = lastDot > lastComma ? "." : ",";
    const thousandSeparator = decimalSeparator === "." ? "," : ".";
    normalized = digits
      .split(thousandSeparator)
      .join("")
      .replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = normalizeSingleSeparator(digits, ",");
  } else if (lastDot >= 0) {
    normalized = normalizeSingleSeparator(digits, ".");
  } else {
    normalized = digits;
  }

  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  if (negative) return null;
  return money(number);
}

function normalizeSingleSeparator(value: string, separator: string): string {
  const parts = value.split(separator);
  if (parts.length === 1) return value;

  const decimals = parts.pop() ?? "";
  const integer = parts.join("");

  if (!integer) {
    // ",50" o ".50" → 0.50
    return `0.${decimals}`;
  }

  // Un separador con uno o dos dígitos detrás es decimal.
  if (decimals.length >= 1 && decimals.length <= 2) {
    return `${integer}.${decimals}`;
  }

  // Tres o más dígitos: separador de miles. "1.234" → 1234.
  return `${integer}${decimals}`;
}

/** Referencia limpia y acotada; null si no hay nada legible. */
export function normalizeReceiptReference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned.slice(0, 80);
}

/** Banco o entidad emisora, acotado. */
export function normalizeReceiptBank(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned.slice(0, 120);
}

/** Moneda del comprobante, sin asumir USD cuando el OCR no la leyó. */
export function normalizeOcrCurrency(value: unknown): OcrCurrency | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "");

  if (["USD", "US$", "$", "DOLAR", "DOLARES", "DÓLAR", "DÓLARES"].includes(cleaned)) {
    return "USD";
  }
  if (
    ["VES", "BS", "BS.", "BSS", "BS.S", "BOLIVAR", "BOLIVARES", "BOLÍVAR", "BOLÍVARES"].includes(
      cleaned,
    )
  ) {
    return "VES";
  }
  return null;
}

/**
 * Fecha de pago en `YYYY-MM-DD`. Acepta ISO, `DD/MM/AAAA` y
 * `DD-MM-AAAA`; cualquier otra cosa devuelve null.
 */
export function normalizeReceiptDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (dmy) return validDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  return null;
}

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * El comprobante se aplica en USD (la cartera es USD). Un pago en
 * bolívares necesita la tasa y la corrección de un humano, así que no
 * se captura automáticamente como si fuera dólares.
 */
export function isUsdOrUnknown(currency: OcrCurrency | null): boolean {
  return currency === null || currency === "USD";
}

/**
 * Corrige el MIME con la firma real de la imagen. WhatsApp suele
 * mandar JPEG; Evolution a veces no dice nada y los comprobantes
 * también llegan en PNG o WEBP.
 */
export function detectImageMime(buffer: Buffer, declared: string): string {
  if (buffer.length >= 8) {
    const png = buffer.subarray(0, 8);
    if (
      png[0] === 0x89 &&
      png[1] === 0x50 &&
      png[2] === 0x4e &&
      png[3] === 0x47
    ) {
      return "image/png";
    }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("ascii") === "GIF") {
    return "image/gif";
  }
  return declared;
}
