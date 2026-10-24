import { getCountryCallingCode, parsePhoneNumberFromString } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

import type {
  CollectionNormalizedRow,
  ImportColumnMapping,
} from "@/types/collections";

function text(value: unknown): string | null {
  if (value == null) return null;
  const result = String(value).replace(/\s+/g, " ").trim();
  return result || null;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function parseDateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    // Serial de Excel (base 1899-12-30).
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000));
    return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  let raw = text(value);
  if (!raw) return null;
  raw = raw.split(/[ T]/)[0];

  let match = raw.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (match) {
    let first = Number(match[1]);
    let second = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;

    let day = first;
    let month = second;
    if (first <= 12 && second > 12) {
      day = second;
      month = first;
    }
    return isoDate(year, month, day);
  }

  return null;
}

export function parseAmountValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value == null) return null;

  let raw = String(value).trim();
  if (!raw) return null;

  raw = raw.replace(/[^\d.,\-]/g, "");
  if (!raw || raw === "-" || raw === "." || raw === ",") return null;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      raw = raw.replace(/\./g, "").replace(",", ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    const decimals = raw.length - lastComma - 1;
    raw = decimals === 3 && raw.length > 4 ? raw.replace(/,/g, "") : raw.replace(",", ".");
  } else if (lastDot >= 0) {
    const decimals = raw.length - lastDot - 1;
    if (decimals === 3 && raw.length > 4) raw = raw.replace(/\./g, "");
  }

  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

export function normalizePhoneValue(
  value: unknown,
  country: CountryCode = "VE",
): { value: string | null; valid: boolean } {
  const raw = text(value);
  if (!raw) return { value: null, valid: true };

  let candidate = raw.replace(/[^\d+]/g, "");
  if (candidate.startsWith("00")) candidate = `+${candidate.slice(2)}`;

  if (!candidate.startsWith("+")) {
    const countryCode = getCountryCallingCode(country);
    const national = candidate.replace(/^0+/, "");
    if (national.startsWith(countryCode) && national.length > countryCode.length + 6) {
      candidate = `+${national}`;
    } else {
      candidate = `+${countryCode}${national}`;
    }
  }

  const parsed = parsePhoneNumberFromString(candidate);
  if (parsed?.isValid()) return { value: parsed.number, valid: true };
  return { value: raw, valid: false };
}

export function inferDocumentType(
  document: string | null,
): "cedula" | "rfc" | "passport" | "other" {
  if (!document) return "other";
  const value = document.trim().toUpperCase();
  if (/^[VE]-?\d{6,9}$/.test(value)) return "cedula";
  if (/^[JG]-?\d{8,10}$/.test(value)) return "rfc";
  if (/^[A-Z]{1,2}\d{6,}$/.test(value)) return "passport";
  return "other";
}

export interface NormalizeResult {
  normalized: CollectionNormalizedRow | null;
  errors: string[];
  warnings: string[];
}

/**
 * Convierte una fila cruda a la forma canónica. Devuelve errores
 * bloqueantes y advertencias que no impiden importar.
 */
export function normalizeImportRow(
  raw: Record<string, unknown>,
  mapping: ImportColumnMapping,
  country: CountryCode = "VE",
): NormalizeResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const get = (field: string): unknown => {
    const header = mapping[field];
    return header ? raw[header] : undefined;
  };

  const name = text(get("name"));
  const folio = text(get("folio"));
  const documentNumber = text(get("document_number"));
  const documentTypeRaw = text(get("document_type"))?.toLowerCase() ?? null;
  const documentType =
    documentTypeRaw && ["dni", "cedula", "rfc", "passport", "other"].includes(documentTypeRaw)
      ? (documentTypeRaw as CollectionNormalizedRow["document_type"])
      : inferDocumentType(documentNumber);

  const phone = normalizePhoneValue(get("phone_primary"), country);
  const phone2 = normalizePhoneValue(get("phone_secondary"), country);

  const installmentRaw = get("installment_number");
  const installmentNumber =
    typeof installmentRaw === "number"
      ? installmentRaw
      : Number(String(installmentRaw ?? "").replace(/[^\d-]/g, ""));

  const dueDate = parseDateValue(get("due_date"));

  let principal = parseAmountValue(get("principal"));
  const total = parseAmountValue(get("total"));
  const interest = parseAmountValue(get("interest")) ?? 0;
  const lateFee = parseAmountValue(get("late_fee")) ?? 0;

  if (principal == null && total != null) {
    principal = total;
    warnings.push("Sin desglose de capital: se usó el total como capital.");
  }

  if (!name) errors.push("Falta el nombre del deudor.");
  if (!folio) errors.push("Falta el folio del crédito.");
  if (!Number.isInteger(installmentNumber) || installmentNumber <= 0) {
    errors.push("El número de cuota debe ser un entero mayor que cero.");
  }
  if (!dueDate) errors.push("La fecha de vencimiento no es válida.");
  if (principal == null) errors.push("Falta el capital (o el total) de la cuota.");
  if (principal != null && principal < 0) errors.push("El capital no puede ser negativo.");
  if (interest < 0) errors.push("El interés no puede ser negativo.");
  if (lateFee < 0) errors.push("La mora no puede ser negativa.");
  if (!documentNumber) warnings.push("Sin documento: se usará nombre + teléfono.");
  if (phone.value && !phone.valid) warnings.push("El teléfono no parece válido; se guardó tal cual.");
  if (phone2.value && !phone2.valid) warnings.push("El teléfono secundario no parece válido.");

  if (principal != null && total != null) {
    const expected = principal + interest + lateFee;
    if (Math.abs(expected - total) > 0.01) {
      warnings.push("El total del archivo no coincide con capital + interés + mora.");
    }
  }

  if (errors.length > 0) {
    return { normalized: null, errors, warnings };
  }

  return {
    normalized: {
      document_type: documentType,
      document_number: documentNumber,
      name: name!,
      phone_primary: phone.value,
      phone_secondary: phone2.value,
      email: text(get("email")),
      address: text(get("address")),
      city: text(get("city")),
      folio: folio!,
      product: text(get("product")),
      installment_number: installmentNumber,
      due_date: dueDate!,
      principal: principal ?? 0,
      interest,
      late_fee: lateFee,
      notes: text(get("notes")),
    },
    errors,
    warnings,
  };
}
