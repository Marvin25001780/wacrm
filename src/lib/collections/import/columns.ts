import type { ImportColumnMapping } from "@/types/collections";

export interface CanonicalField {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
}

/**
 * Diccionario de columnas aceptadas. El orden importa: los campos
 * más específicos van primero para que "fecha_vencimiento" no se
 * quede con "fecha".
 */
export const CANONICAL_FIELDS: CanonicalField[] = [
  {
    key: "document_number",
    label: "Documento",
    required: false,
    aliases: [
      "documento",
      "dni",
      "cedula",
      "cédula",
      "rfc",
      "rif",
      "identificacion",
      "identificación",
      "id_cliente",
      "numero_documento",
      "nro_documento",
    ],
  },
  {
    key: "document_type",
    label: "Tipo de documento",
    required: false,
    aliases: ["tipo_documento", "tipo_doc", "document_type"],
  },
  {
    key: "name",
    label: "Nombre del deudor",
    required: true,
    aliases: [
      "nombre",
      "nombre_completo",
      "cliente",
      "deudor",
      "titular",
      "razon_social",
      "razón_social",
      "name",
    ],
  },
  {
    key: "phone_primary",
    label: "Teléfono principal",
    required: false,
    aliases: [
      "telefono",
      "teléfono",
      "telefono_principal",
      "celular",
      "movil",
      "móvil",
      "whatsapp",
      "telf",
      "phone",
    ],
  },
  {
    key: "phone_secondary",
    label: "Teléfono secundario",
    required: false,
    aliases: ["telefono_secundario", "telefono_2", "celular_2", "otro_telefono"],
  },
  {
    key: "email",
    label: "Email",
    required: false,
    aliases: ["email", "correo", "correo_electronico", "e_mail"],
  },
  {
    key: "address",
    label: "Dirección",
    required: false,
    aliases: ["direccion", "dirección", "domicilio", "address"],
  },
  {
    key: "city",
    label: "Ciudad",
    required: false,
    aliases: ["ciudad", "municipio", "city"],
  },
  {
    key: "folio",
    label: "Folio del crédito",
    required: true,
    aliases: [
      "folio",
      "credito",
      "crédito",
      "id_credito",
      "numero_credito",
      "nro_credito",
      "pagare",
      "pagaré",
      "contrato",
      "operacion",
      "operación",
    ],
  },
  {
    key: "product",
    label: "Producto",
    required: false,
    aliases: ["producto", "tipo_credito", "linea", "línea", "product"],
  },
  {
    key: "installment_number",
    label: "Número de cuota",
    required: true,
    aliases: [
      "cuota",
      "numero_cuota",
      "número_cuota",
      "num_cuota",
      "no_cuota",
      "nro_cuota",
      "n_cuota",
      "installment",
      "installment_number",
    ],
  },
  {
    key: "due_date",
    label: "Fecha de vencimiento",
    required: true,
    aliases: [
      "vencimiento",
      "fecha_vencimiento",
      "fecha_venc",
      "fecha_pago",
      "due_date",
      "fecha",
    ],
  },
  {
    key: "principal",
    label: "Capital",
    required: false,
    aliases: ["capital", "monto_capital", "principal", "monto", "importe"],
  },
  {
    key: "interest",
    label: "Interés",
    required: false,
    aliases: ["interes", "interés", "intereses", "rendimiento", "interest"],
  },
  {
    key: "late_fee",
    label: "Mora / recargo",
    required: false,
    aliases: ["mora", "recargo", "interes_moratorio", "interés_moratorio", "late_fee"],
  },
  {
    key: "total",
    label: "Total de la cuota",
    required: false,
    aliases: ["total", "saldo", "monto_cuota", "importe_cuota", "total_cuota"],
  },
  {
    key: "notes",
    label: "Notas",
    required: false,
    aliases: ["notas", "observaciones", "comentario", "notes"],
  },
];

/**
 * Columnas de la plantilla descargable, en el orden en que se
 * muestran. Es la lista corta que usa el equipo de cobranza: los
 * campos que no aparecen aquí (tipo de documento, dirección, ciudad,
 * producto, capital e interés) siguen aceptándose al mapear un
 * archivo de otro sistema, pero no forman parte de la plantilla.
 */
export const TEMPLATE_FIELDS: { key: string; label: string }[] = [
  { key: "document_number", label: "Documento" },
  { key: "name", label: "Nombre del deudor" },
  { key: "phone_primary", label: "Teléfono principal" },
  { key: "phone_secondary", label: "Teléfono secundario" },
  { key: "email", label: "Email" },
  { key: "folio", label: "Folio del crédito" },
  { key: "installment_number", label: "Número de cuota" },
  { key: "due_date", label: "Fecha de vencimiento" },
  { key: "late_fee", label: "Mora / recargo" },
  { key: "total", label: "Total de la cuota" },
  { key: "notes", label: "Notas" },
];

/** Fila de ejemplo de la plantilla, alineada con TEMPLATE_FIELDS. */
export const TEMPLATE_EXAMPLE: string[] = [
  "V-12345678",
  "Juan Pérez",
  "+58 414 1234567",
  "",
  "juan@example.com",
  "CR-001",
  "1",
  "2026-11-15",
  "0",
  "550.00",
  "",
];

/** Campos que no van en la plantilla pero se aceptan al mapear. */
export const OPTIONAL_IMPORT_KEYS = new Set([
  "document_type",
  "address",
  "city",
  "product",
  "principal",
  "interest",
]);

export function canonicalFieldLabel(key: string): string {
  return CANONICAL_FIELDS.find((field) => field.key === key)?.label ?? key;
}

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function scoreHeader(header: string, alias: string): number {
  if (!header || !alias) return 0;
  if (header === alias) return 100;
  if (header.startsWith(`${alias}_`) || header.endsWith(`_${alias}`)) return 85;
  if (header.includes(alias) || alias.includes(header)) return 70;

  const headerTokens = new Set(header.split("_"));
  const aliasTokens = alias.split("_");
  if (aliasTokens.length > 1 && aliasTokens.every((token) => headerTokens.has(token))) {
    return 60;
  }
  return 0;
}

export function autoMapFields(
  headers: string[],
  fields: CanonicalField[],
): ImportColumnMapping {
  const mapping: ImportColumnMapping = {};
  const used = new Set<string>();
  const normalized = headers.map((header) => ({
    original: header,
    norm: normalizeHeader(header),
  }));

  for (const field of fields) {
    let best: { header: string; score: number } | null = null;

    for (const header of normalized) {
      if (used.has(header.original)) continue;
      for (const alias of field.aliases) {
        const score = scoreHeader(header.norm, normalizeHeader(alias));
        if (score > (best?.score ?? 0)) {
          best = { header: header.original, score };
        }
      }
    }

    if (best && best.score >= 60) {
      mapping[field.key] = best.header;
      used.add(best.header);
    } else {
      mapping[field.key] = null;
    }
  }

  return mapping;
}

/**
 * Auto-mapeo por nombre de encabezado. Cada encabezado se usa una
 * sola vez; si dos campos compiten, gana el de mayor score.
 */
export function autoMapColumns(headers: string[]): ImportColumnMapping {
  return autoMapFields(headers, CANONICAL_FIELDS);
}

export function missingRequiredFields(mapping: ImportColumnMapping): string[] {
  const missing: string[] = [];

  for (const field of CANONICAL_FIELDS) {
    if (!field.required) continue;
    if (!mapping[field.key]) missing.push(field.label);
  }

  if (!mapping.principal && !mapping.total) {
    missing.push("Capital o total de la cuota");
  }

  return missing;
}
