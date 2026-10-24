// ============================================================
// Tipos del módulo Cobranza (migraciones 073-078)
//
// Modelo: deudor 1:N créditos 1:N cuotas 1:N pagos.
// La moneda del módulo es USD (ver collection_settings.currency).
// ============================================================

export const COLLECTION_CURRENCY = "USD";

// ------------------------------------------------------------
// Enums de dominio
// ------------------------------------------------------------
export type CollectionTramo = "1_15" | "16_30" | "31_60" | "61_90" | "90_plus";

export type CollectionSegment =
  | "preventiva"
  | "temprana"
  | "media"
  | "tardia"
  | "critica";

export type CollectionDebtorStatus =
  | "nuevo"
  | "contactado"
  | "negociacion"
  | "acuerdo"
  | "pagado"
  | "ilocalizable"
  | "juridico";

export type CollectionCreditStatus =
  | "active"
  | "paid"
  | "restructured"
  | "legal"
  | "cancelled";

export type CollectionInstallmentStatus =
  | "pending"
  | "partial"
  | "paid"
  | "cancelled";

export type CollectionPaymentMethod =
  | "cash"
  | "transfer"
  | "card"
  | "check"
  | "other";

export type CollectionPaymentSource = "manual" | "import" | "link" | "adjustment";

export type CollectionActionChannel =
  | "call"
  | "whatsapp"
  | "sms"
  | "email"
  | "visit"
  | "other";

export type CollectionActionDirection = "outbound" | "inbound";

export type CollectionPromiseStatus =
  | "pending"
  | "kept"
  | "partial"
  | "broken"
  | "cancelled";

export type CollectionAssignmentQueue =
  | "general"
  | "senior"
  | "legal"
  | "whatsapp";

export type CollectionImportStatus =
  | "uploaded"
  | "mapping"
  | "validated"
  | "committed"
  | "failed"
  | "cancelled";

export type CollectionImportRowStatus =
  | "pending"
  | "valid"
  | "warning"
  | "error"
  | "imported"
  | "skipped";

// ------------------------------------------------------------
// Etiquetas
// ------------------------------------------------------------
export const COLLECTION_TRAMOS: { value: CollectionTramo; label: string; days: string }[] = [
  { value: "1_15", label: "Preventiva", days: "1-15 días" },
  { value: "16_30", label: "Mora temprana", days: "16-30 días" },
  { value: "31_60", label: "Mora media", days: "31-60 días" },
  { value: "61_90", label: "Mora tardía", days: "61-90 días" },
  { value: "90_plus", label: "Crítica / jurídica", days: "90+ días" },
];

export const COLLECTION_SEGMENTS: { value: CollectionSegment; label: string }[] = [
  { value: "preventiva", label: "Preventiva" },
  { value: "temprana", label: "Temprana" },
  { value: "media", label: "Media" },
  { value: "tardia", label: "Tardía" },
  { value: "critica", label: "Crítica" },
];

export const COLLECTION_DEBTOR_STATUSES: { value: CollectionDebtorStatus; label: string }[] = [
  { value: "nuevo", label: "Nuevo" },
  { value: "contactado", label: "Contactado" },
  { value: "negociacion", label: "Negociación" },
  { value: "acuerdo", label: "Acuerdo" },
  { value: "pagado", label: "Pagado" },
  { value: "ilocalizable", label: "Ilocalizable" },
  { value: "juridico", label: "Jurídico" },
];

export const COLLECTION_CREDIT_STATUSES: { value: CollectionCreditStatus; label: string }[] = [
  { value: "active", label: "Activo" },
  { value: "paid", label: "Pagado" },
  { value: "restructured", label: "Reestructurado" },
  { value: "legal", label: "Jurídico" },
  { value: "cancelled", label: "Anulado" },
];

export const COLLECTION_INSTALLMENT_STATUSES: {
  value: CollectionInstallmentStatus;
  label: string;
}[] = [
  { value: "pending", label: "Pendiente" },
  { value: "partial", label: "Parcial" },
  { value: "paid", label: "Pagada" },
  { value: "cancelled", label: "Anulada" },
];

export const COLLECTION_PROMISE_STATUSES: { value: CollectionPromiseStatus; label: string }[] = [
  { value: "pending", label: "Pendiente" },
  { value: "kept", label: "Cumplida" },
  { value: "partial", label: "Parcial" },
  { value: "broken", label: "Rota" },
  { value: "cancelled", label: "Cancelada" },
];

export const COLLECTION_CHANNELS: { value: CollectionActionChannel; label: string }[] = [
  { value: "call", label: "Llamada" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "visit", label: "Visita" },
  { value: "other", label: "Otro" },
];

export const COLLECTION_PAYMENT_METHODS: {
  value: CollectionPaymentMethod;
  label: string;
}[] = [
  { value: "cash", label: "Efectivo" },
  { value: "transfer", label: "Transferencia" },
  { value: "card", label: "Tarjeta" },
  { value: "check", label: "Cheque" },
  { value: "other", label: "Otro" },
];

export const COLLECTION_QUEUES: { value: CollectionAssignmentQueue; label: string }[] = [
  { value: "general", label: "General" },
  { value: "senior", label: "Senior" },
  { value: "legal", label: "Jurídico" },
  { value: "whatsapp", label: "WhatsApp" },
];

export function collectionTramo(days: number | null | undefined): CollectionTramo {
  if (days == null || days <= 15) return "1_15";
  if (days <= 30) return "16_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_plus";
}

export function collectionSegmentForDays(days: number | null | undefined): CollectionSegment {
  if (days == null || days <= 15) return "preventiva";
  if (days <= 30) return "temprana";
  if (days <= 60) return "media";
  if (days <= 90) return "tardia";
  return "critica";
}

export function labelFor<T extends string>(
  list: { value: T; label: string }[],
  value: string | null | undefined,
): string {
  if (!value) return "";
  return list.find((item) => item.value === value)?.label ?? value;
}

// ------------------------------------------------------------
// Entidades
// ------------------------------------------------------------
export interface CollectionSettings {
  account_id: string;
  country_code: string;
  timezone: string;
  currency: "USD";
  business_hours_start: string;
  business_hours_end: string;
  created_at: string;
  updated_at: string;
}

export interface CollectionPortfolio {
  id: string;
  account_id: string;
  name: string;
  description?: string | null;
  source: "manual" | "excel" | "csv" | "api";
  status: "draft" | "active" | "archived";
  currency: "USD";
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionDebtor {
  id: string;
  account_id: string;
  portfolio_id?: string | null;
  contact_id?: string | null;
  document_type?: "dni" | "cedula" | "rfc" | "passport" | "other" | null;
  document_number?: string | null;
  name: string;
  phone_primary?: string | null;
  phone_secondary?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  segment: CollectionSegment;
  status: CollectionDebtorStatus;
  assigned_to?: string | null;
  priority_score: number;
  priority_reason?: string | null;
  priority_updated_at?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionCredit {
  id: string;
  account_id: string;
  debtor_id: string;
  portfolio_id?: string | null;
  folio: string;
  product?: string | null;
  currency: "USD";
  principal: number;
  interest: number;
  late_fee: number;
  total: number;
  opened_at?: string | null;
  status: CollectionCreditStatus;
  legacy_receivable_id?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionInstallment {
  id: string;
  account_id: string;
  credit_id: string;
  debtor_id: string;
  number: number;
  due_date: string;
  principal: number;
  interest: number;
  late_fee: number;
  total: number;
  paid_amount: number;
  status: CollectionInstallmentStatus;
  paid_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionPayment {
  id: string;
  account_id: string;
  installment_id: string;
  credit_id: string;
  debtor_id: string;
  amount: number;
  paid_at: string;
  method?: CollectionPaymentMethod | null;
  reference?: string | null;
  source: CollectionPaymentSource;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface CollectionOutcome {
  id: string;
  account_id?: string | null;
  code: string;
  label: string;
  level: 1 | 2 | 3;
  parent_code?: string | null;
  requires_amount: boolean;
  requires_date: boolean;
  requires_reason: boolean;
  active: boolean;
  sort: number;
  created_at: string;
}

export interface CollectionAction {
  id: string;
  account_id: string;
  debtor_id: string;
  credit_id?: string | null;
  installment_id?: string | null;
  user_id: string;
  channel: CollectionActionChannel;
  direction: CollectionActionDirection;
  level1_code: string;
  level2_code?: string | null;
  notes?: string | null;
  call_duration_seconds?: number | null;
  started_at?: string | null;
  ended_at?: string | null;
  promise_id?: string | null;
  created_at: string;
}

export interface CollectionPromise {
  id: string;
  account_id: string;
  debtor_id: string;
  credit_id: string;
  action_id?: string | null;
  amount: number;
  due_date: string;
  status: CollectionPromiseStatus;
  paid_amount: number;
  channel?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
}

export interface CollectionAssignment {
  id: string;
  account_id: string;
  debtor_id: string;
  user_id: string;
  queue: CollectionAssignmentQueue;
  priority_score: number;
  reason?: string | null;
  status: "active" | "done" | "reassigned" | "expired";
  assigned_at: string;
  expires_at?: string | null;
}

export interface CollectionPolicy {
  id: string;
  account_id: string;
  tramo: CollectionTramo;
  max_discount_pct: number;
  max_attempts_per_day: number;
  allowed_start: string;
  allowed_end: string;
  ptp_max_days: number;
  ptp_grace_days: number;
  min_down_payment_pct: number;
  target_recovery_pct: number;
  script_template?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CollectionCommissionRule {
  id: string;
  account_id: string;
  tramo: CollectionTramo;
  percentage: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CollectionImportBatch {
  id: string;
  account_id: string;
  portfolio_id?: string | null;
  file_name: string;
  file_type: "xlsx" | "csv";
  file_size: number;
  status: CollectionImportStatus;
  mapping?: Record<string, string | null> | null;
  summary?: CollectionImportSummary | null;
  error_message?: string | null;
  created_by?: string | null;
  created_at: string;
  committed_at?: string | null;
}

export interface CollectionImportSummary {
  created_debtors?: number;
  created_credits?: number;
  created_installments?: number;
  updated_installments?: number;
  errors?: number;
  committed_rows?: number;
  total_rows?: number;
  valid_rows?: number;
  warning_rows?: number;
  error_rows?: number;
}

export interface CollectionImportRow {
  id: string;
  batch_id: string;
  account_id: string;
  row_number: number;
  raw: Record<string, unknown>;
  normalized?: CollectionNormalizedRow | null;
  status: CollectionImportRowStatus;
  errors?: string[] | null;
  debtor_id?: string | null;
  credit_id?: string | null;
  installment_id?: string | null;
  created_at: string;
}

// ------------------------------------------------------------
// Fila normalizada por el importador
// ------------------------------------------------------------
export interface CollectionNormalizedRow {
  document_type?: "dni" | "cedula" | "rfc" | "passport" | "other" | null;
  document_number?: string | null;
  name: string;
  phone_primary?: string | null;
  phone_secondary?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  folio: string;
  product?: string | null;
  installment_number: number;
  due_date: string;
  principal: number;
  interest: number;
  late_fee: number;
  notes?: string | null;
}

// ------------------------------------------------------------
// Vistas / agregados
// ------------------------------------------------------------
export interface CollectionDebtorSummary {
  id: string;
  account_id: string;
  portfolio_id?: string | null;
  name: string;
  document_number?: string | null;
  phone_primary?: string | null;
  email?: string | null;
  segment: CollectionSegment;
  status: CollectionDebtorStatus;
  assigned_to?: string | null;
  priority_score: number;
  priority_reason?: string | null;
  created_at: string;
  updated_at: string;
  open_installments: number;
  balance: number;
  overdue_balance: number;
  days_overdue_max: number;
  last_action_at?: string | null;
}

export interface CollectionAgingRow {
  account_id: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}

export interface CollectionPromiseStatsRow {
  account_id: string;
  status: CollectionPromiseStatus;
  count: number;
  amount: number;
  paid_amount: number;
}

export interface CollectionDailyRecoveryRow {
  account_id: string;
  paid_at: string;
  payments: number;
  recovered: number;
}

export interface CollectionAgentPerformanceRow {
  account_id: string;
  user_id: string;
  actions: number;
  contacted: number;
  promises_created: number;
}

export interface CollectionCommissionRow {
  account_id: string;
  user_id: string | null;
  month: string;
  recovered: number;
  commission: number;
}

// ------------------------------------------------------------
// Resultados del importador
// ------------------------------------------------------------
export interface ImportColumnMapping {
  /** Campo canónico -> encabezado original del archivo. */
  [canonical: string]: string | null;
}

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface ImportPreviewRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  normalized: CollectionNormalizedRow | null;
  status: "valid" | "warning" | "error";
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  headers: string[];
  mapping: ImportColumnMapping;
  rows: ImportPreviewRow[];
  summary: {
    total: number;
    valid: number;
    warning: number;
    error: number;
  };
}
