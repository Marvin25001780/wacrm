// ============================================================
// Enlaces de pago y comprobantes — piezas puras (migración 135).
//
// Sin red ni claves: lo usan la página pública, la revisión y la
// vista previa de recordatorios.
// ============================================================

export interface PaymentSettings {
  account_id: string;
  enabled: boolean;
  bank_name: string | null;
  account_number: string | null;
  account_type: string | null;
  account_holder: string | null;
  holder_document: string | null;
  mobile_payment_phone: string | null;
  mobile_payment_bank: string | null;
  support_phone: string | null;
  instructions: string | null;
  link_expiry_days: number;
}

export interface PublicInstallment {
  number: number;
  due_date: string;
  balance: number | string;
  status: string;
}

export interface PaymentInstructions {
  enabled: boolean;
  bank_name: string | null;
  account_number: string | null;
  account_type: string | null;
  account_holder: string | null;
  holder_document: string | null;
  mobile_payment_phone: string | null;
  mobile_payment_bank: string | null;
  support_phone: string | null;
  notes: string | null;
}

export type PublicPaymentLink =
  | {
      ok: true;
      status: "active";
      expires_at: string;
      business_name: string;
      debtor_name: string;
      currency: string;
      link_amount: number | string | null;
      total_balance: number | string;
      instructions: PaymentInstructions;
      installments: PublicInstallment[];
    }
  | {
      ok: false;
      reason: string;
    };

export type ReceiptStatus = "pending" | "approved" | "rejected";

export interface CollectionReceipt {
  id: string;
  account_id: string;
  debtor_id: string;
  payment_link_id: string | null;
  installment_id: string | null;
  channel: string;
  amount: number | string;
  paid_at: string;
  reference: string | null;
  bank: string | null;
  file_url: string | null;
  mime_type: string | null;
  notes: string | null;
  status: ReceiptStatus;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  debtor_name?: string | null;
}

export const DEFAULT_PAYMENT_SETTINGS: Omit<PaymentSettings, "account_id"> = {
  enabled: false,
  bank_name: null,
  account_number: null,
  account_type: null,
  account_holder: null,
  holder_document: null,
  mobile_payment_phone: null,
  mobile_payment_bank: null,
  support_phone: null,
  instructions: null,
  link_expiry_days: 7,
};

export function defaultPaymentSettings(accountId: string): PaymentSettings {
  return { account_id: accountId, ...DEFAULT_PAYMENT_SETTINGS };
}

export function normalizePaymentSettings(
  input: Partial<PaymentSettings> & { account_id: string },
  existing?: PaymentSettings | null,
): PaymentSettings {
  const base = existing ?? defaultPaymentSettings(input.account_id);
  const text = (value: unknown, fallback: string | null, max = 300) => {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };
  const days = Number(input.link_expiry_days ?? base.link_expiry_days);
  return {
    account_id: input.account_id,
    enabled: Boolean(input.enabled ?? base.enabled),
    bank_name: text(input.bank_name, base.bank_name, 120),
    account_number: text(input.account_number, base.account_number, 40),
    account_type: text(input.account_type, base.account_type, 40),
    account_holder: text(input.account_holder, base.account_holder, 160),
    holder_document: text(input.holder_document, base.holder_document, 40),
    mobile_payment_phone: text(
      input.mobile_payment_phone,
      base.mobile_payment_phone,
      40,
    ),
    mobile_payment_bank: text(
      input.mobile_payment_bank,
      base.mobile_payment_bank,
      80,
    ),
    support_phone: text(input.support_phone, base.support_phone, 40),
    instructions: text(input.instructions, base.instructions, 2000),
    link_expiry_days: Number.isFinite(days)
      ? Math.min(Math.max(Math.round(days), 1), 90)
      : base.link_expiry_days,
  };
}

const LINK_REASON_LABELS: Record<string, string> = {
  not_found: "Este enlace no existe o fue reemplazado.",
  expired: "Este enlace venció. Pide uno nuevo a tu asesor.",
  used: "Este enlace ya fue utilizado porque la deuda está pagada.",
  cancelled: "Este enlace fue anulado. Pide uno nuevo a tu asesor.",
  link_unavailable: "Este enlace ya no está disponible.",
};

export function paymentLinkReasonLabel(reason: string): string {
  return LINK_REASON_LABELS[reason] ?? "Este enlace no está disponible.";
}

export function receiptStatusLabel(status: ReceiptStatus): string {
  switch (status) {
    case "pending":
      return "Pendiente";
    case "approved":
      return "Aprobado";
    case "rejected":
      return "Rechazado";
  }
}

/** URL absoluta del enlace público. */
export function paymentLinkUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/pagar/${encodeURIComponent(token)}`;
}

/** Solo los dígitos, para armar el enlace de WhatsApp. */
export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/** Filas legibles de las instrucciones que el negocio haya cargado. */
export function instructionRows(
  instructions: PaymentInstructions,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (instructions.bank_name) {
    rows.push({ label: "Banco", value: instructions.bank_name });
  }
  if (instructions.account_number) {
    rows.push({ label: "Cuenta", value: instructions.account_number });
  }
  if (instructions.account_type) {
    rows.push({ label: "Tipo de cuenta", value: instructions.account_type });
  }
  if (instructions.account_holder) {
    rows.push({ label: "Titular", value: instructions.account_holder });
  }
  if (instructions.holder_document) {
    rows.push({ label: "Documento", value: instructions.holder_document });
  }
  if (instructions.mobile_payment_phone) {
    rows.push({
      label: "Pago móvil",
      value: [instructions.mobile_payment_bank, instructions.mobile_payment_phone]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return rows;
}

/** Validación de la referencia antes de enviarla al servidor. */
export function referenceError(reference: string): string | null {
  const value = reference.trim();
  if (!value) return "Escribe la referencia de la transferencia.";
  if (value.length < 3) return "La referencia es demasiado corta.";
  if (value.length > 80) return "La referencia no puede pasar de 80 caracteres.";
  return null;
}
