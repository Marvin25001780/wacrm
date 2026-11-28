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
  /** Captura imágenes de comprobantes que llegan por WhatsApp (136). */
  receipt_capture_enabled: boolean;
  /** Responde al deudor cuando su comprobante quedó capturado. */
  receipt_ack_enabled: boolean;
  /** Texto del acuse; admite {{deudor}}, {{monto}} y {{referencia}}. */
  receipt_ack_text: string | null;
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

/** Cómo nació el comprobante (migración 136). */
export type ReceiptCaptureSource = "link" | "agent" | "ocr" | "manual";

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
  /** Metadatos 136 (opcionales para tolerar una base sin migrar). */
  conversation_id?: string | null;
  source_message_id?: string | null;
  capture_source?: ReceiptCaptureSource;
  ocr_confidence?: number | string | null;
  captured_at?: string | null;
  /** URL firmada del adjunto, resuelta por la API de la bandeja. */
  file_signed_url?: string | null;
}

/** Acuse por defecto cuando el deudor manda la foto del pago. */
export const DEFAULT_RECEIPT_ACK_TEXT =
  "¡Gracias! Recibimos tu comprobante y quedó en revisión. Te confirmamos por aquí cuando el pago esté aplicado.";

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
  receipt_capture_enabled: true,
  receipt_ack_enabled: true,
  receipt_ack_text: DEFAULT_RECEIPT_ACK_TEXT,
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
    receipt_capture_enabled: Boolean(
      input.receipt_capture_enabled ?? base.receipt_capture_enabled,
    ),
    receipt_ack_enabled: Boolean(
      input.receipt_ack_enabled ?? base.receipt_ack_enabled,
    ),
    receipt_ack_text: text(
      input.receipt_ack_text,
      base.receipt_ack_text,
      1000,
    ),
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

const CAPTURE_SOURCE_LABELS: Record<ReceiptCaptureSource, string> = {
  link: "Enlace de pago",
  agent: "Agente de IA",
  ocr: "OCR de WhatsApp",
  manual: "Manual",
};

export function receiptCaptureSourceLabel(
  source: ReceiptCaptureSource | null | undefined,
): string {
  return CAPTURE_SOURCE_LABELS[source ?? "manual"] ?? "Manual";
}

/** Confianza del OCR como porcentaje legible ("92 %"). */
export function ocrConfidenceLabel(
  confidence: number | string | null | undefined,
): string | null {
  const value = Number(confidence);
  if (!Number.isFinite(value)) return null;
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return `${percent} %`;
}

/**
 * Rellena el acuse del comprobante. No interpreta plantillas de Meta:
 * solo reemplaza las tres variables documentadas en el panel.
 */
export function fillReceiptAckText(
  template: string | null | undefined,
  values: {
    debtorName?: string | null;
    amountLabel?: string | null;
    reference?: string | null;
  },
): string {
  const base = (template ?? DEFAULT_RECEIPT_ACK_TEXT).trim();
  return base
    .replace(/\{\{\s*deudor\s*\}\}/gi, values.debtorName?.trim() || "deudor")
    .replace(/\{\{\s*monto\s*\}\}/gi, values.amountLabel?.trim() || "")
    .replace(/\{\{\s*referencia\s*\}\}/gi, values.reference?.trim() || "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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
