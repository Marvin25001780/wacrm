import type {
  CollectionPaymentMethod,
  CollectionPaymentNormalizedRow,
  PaymentImportColumnMapping,
  PaymentImportPreview,
  PaymentImportPreviewRow,
  ParsedSheet,
} from "@/types/collections";
import type { CanonicalField } from "./columns";
import { autoMapFields } from "./columns";
import { parseAmountValue, parseDateValue } from "./normalize";

/** Columnas de la plantilla de pagos, en orden. */
export const PAYMENT_TEMPLATE_FIELDS: { key: string; label: string }[] = [
  { key: "document_number", label: "Documento" },
  { key: "folio", label: "Folio del crédito" },
  { key: "installment_number", label: "Número de cuota" },
  { key: "amount", label: "Monto" },
  { key: "paid_at", label: "Fecha de pago" },
  { key: "method", label: "Método" },
  { key: "reference", label: "Referencia" },
  { key: "notes", label: "Notas" },
];

export const PAYMENT_TEMPLATE_EXAMPLE: string[] = [
  "V-12345678",
  "CR-001",
  "1",
  "550.00",
  "2026-10-24",
  "transferencia",
  "REF-0001",
  "",
];

export const PAYMENT_FIELDS: CanonicalField[] = [
  {
    key: "document_number",
    label: "Documento",
    required: false,
    aliases: [
      "documento",
      "cedula",
      "cédula",
      "dni",
      "rif",
      "identificacion",
      "identificación",
      "cliente",
    ],
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
      "contrato",
      "pagare",
      "pagaré",
      "operacion",
      "operación",
    ],
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
    ],
  },
  {
    key: "amount",
    label: "Monto",
    required: true,
    aliases: ["monto", "importe", "pago", "abono", "cantidad", "amount", "total_pagado"],
  },
  {
    key: "paid_at",
    label: "Fecha de pago",
    required: true,
    aliases: ["fecha_pago", "fecha_abono", "fecha", "paid_at", "fecha_pago_real"],
  },
  {
    key: "method",
    label: "Método",
    required: false,
    aliases: ["metodo", "método", "metodo_pago", "forma_pago", "canal", "method"],
  },
  {
    key: "reference",
    label: "Referencia",
    required: false,
    aliases: ["referencia", "ref", "comprobante", "transaccion", "transacción", "reference"],
  },
  {
    key: "notes",
    label: "Notas",
    required: false,
    aliases: ["notas", "observaciones", "comentario", "notes"],
  },
];

const METHOD_MAP: Record<string, CollectionPaymentMethod> = {
  efectivo: "cash",
  cash: "cash",
  contado: "cash",
  transferencia: "transfer",
  transfer: "transfer",
  "pago movil": "transfer",
  "pago móvil": "transfer",
  deposito: "transfer",
  depósito: "transfer",
  tarjeta: "card",
  card: "card",
  debito: "card",
  débito: "card",
  credito: "card",
  crédito: "card",
  cheque: "check",
  check: "check",
  otro: "other",
  other: "other",
};

function text(value: unknown): string | null {
  if (value == null) return null;
  const result = String(value).replace(/\s+/g, " ").trim();
  return result || null;
}

function parseMethod(value: unknown): {
  method: CollectionPaymentMethod | null;
  warning: string | null;
} {
  const raw = text(value);
  if (!raw) return { method: null, warning: null };
  const key = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const found = METHOD_MAP[key];
  if (found) return { method: found, warning: null };
  return { method: "other", warning: `Método "${raw}" no reconocido; se guardó como otro.` };
}

export function autoMapPaymentColumns(headers: string[]): PaymentImportColumnMapping {
  return autoMapFields(headers, PAYMENT_FIELDS);
}

export function missingPaymentFields(mapping: PaymentImportColumnMapping): string[] {
  return PAYMENT_FIELDS.filter((field) => field.required && !mapping[field.key]).map(
    (field) => field.label,
  );
}

export interface PaymentInstallmentRef {
  installment_id: string;
  credit_id: string;
  debtor_id: string;
  debtor_name: string | null;
  document_number: string | null;
  folio: string;
  installment_number: number;
  balance: number;
}

export function installmentKey(folio: string, number: number): string {
  return `${folio.trim().toLowerCase()}|${number}`;
}

/**
 * Normaliza cada fila y la cruza contra las cuotas reales.
 * No escribe nada: el resultado se guarda como vista previa.
 */
export function buildPaymentPreview(
  sheet: ParsedSheet,
  mapping: PaymentImportColumnMapping,
  refs: Map<string, PaymentInstallmentRef>,
): PaymentImportPreview {
  const rows: PaymentImportPreviewRow[] = [];
  const seen = new Set<string>();
  const committedByInstallment = new Map<string, number>();

  let valid = 0;
  let warning = 0;
  let error = 0;

  const get = (raw: Record<string, unknown>, field: string): unknown => {
    const header = mapping[field];
    return header ? raw[header] : undefined;
  };

  sheet.rows.forEach((raw, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const folio = text(get(raw, "folio"));
    const installmentRaw = get(raw, "installment_number");
    const installmentNumber = Number(String(installmentRaw ?? "").replace(/[^\d-]/g, ""));
    const amount = parseAmountValue(get(raw, "amount"));
    const paidAt = parseDateValue(get(raw, "paid_at"));
    const { method, warning: methodWarning } = parseMethod(get(raw, "method"));
    if (methodWarning) warnings.push(methodWarning);

    if (!folio) errors.push("Falta el folio del crédito.");
    if (!Number.isInteger(installmentNumber) || installmentNumber <= 0) {
      errors.push("El número de cuota debe ser un entero mayor que cero.");
    }
    if (amount == null || amount <= 0) errors.push("El monto debe ser mayor que cero.");
    if (!paidAt) errors.push("La fecha de pago no es válida.");

    let ref: PaymentInstallmentRef | null = null;
    if (folio && Number.isInteger(installmentNumber) && installmentNumber > 0) {
      const key = installmentKey(folio, installmentNumber);
      ref = refs.get(key) ?? null;

      if (!ref) {
        errors.push(`No existe la cuota ${installmentNumber} del crédito ${folio}.`);
      } else if (ref.balance <= 0) {
        errors.push(`La cuota ${installmentNumber} de ${folio} ya está pagada.`);
      } else if (!seen.has(key)) {
        seen.add(key);
      }
    }

    if (ref && amount != null && amount > 0) {
      const already = committedByInstallment.get(ref.installment_id) ?? 0;
      if (already + amount > ref.balance + 0.005) {
        errors.push(
          `El monto excede el saldo de la cuota (saldo ${ref.balance.toFixed(2)}, ya usado ${already.toFixed(2)}).`,
        );
      } else {
        committedByInstallment.set(ref.installment_id, already + amount);
        if (already + amount < ref.balance) {
          warnings.push("Pago parcial: la cuota quedará con saldo.");
        }
      }
    }

    const documentNumber = text(get(raw, "document_number"));
    if (ref && documentNumber && ref.document_number) {
      const normalizeDoc = (value: string) => value.replace(/[^a-z0-9]/gi, "").toUpperCase();
      if (normalizeDoc(documentNumber) !== normalizeDoc(ref.document_number)) {
        warnings.push(
          `El documento no coincide con el del crédito (${ref.document_number}).`,
        );
      }
    }

    const status: PaymentImportPreviewRow["status"] =
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid";
    if (status === "valid") valid += 1;
    else if (status === "warning") warning += 1;
    else error += 1;

    const normalized: CollectionPaymentNormalizedRow | null =
      errors.length > 0
        ? null
        : {
            document_number: documentNumber,
            folio: folio!,
            installment_number: installmentNumber,
            amount: amount!,
            paid_at: paidAt!,
            method,
            reference: text(get(raw, "reference")),
            notes: text(get(raw, "notes")),
            installment_id: ref?.installment_id ?? null,
            credit_id: ref?.credit_id ?? null,
            debtor_id: ref?.debtor_id ?? null,
            debtor_name: ref?.debtor_name ?? null,
            balance: ref?.balance ?? null,
          };

    rows.push({
      rowNumber: index + 2,
      raw,
      normalized,
      status,
      errors,
      warnings,
    });
  });

  return {
    headers: sheet.headers,
    mapping,
    rows,
    summary: { total: rows.length, valid, warning, error },
  };
}
