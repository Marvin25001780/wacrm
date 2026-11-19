// ============================================================
// Exportación de reportes de telefonía a CSV (sin migración).
//
// Los reportes de /telefonia/reportes se calculan en el servidor y se
// dibujan en pantalla. Para llevarlos a Excel o compartirlos con el
// cliente hacía falta un archivo; aquí están los constructores puros
// (sin red ni base) y la API solo los envuelve.
//
// Decisiones:
//   * Separador `;` y BOM UTF-8: es lo que Excel en español abre en
//     columnas y sin romper los acentos (Teléfono, Perdidas…).
//   * Fechas en hora de Venezuela y en formato `YYYY-MM-DD HH:mm`,
//     legible y ordenable.
//   * Los segundos van como número entero, no como "2 min": el
//     archivo se usa para sumar y graficar.
//   * Las celdas que empiezan por `=`, `@` o tabulador se neutralizan
//     para que Excel no las interprete como fórmula.
// ============================================================

import {
  CALL_TRANSCRIPT_STATUSES,
  callDirectionLabel,
  callDispositionLabel,
  callSessionStatusLabel,
  callbackReasonLabel,
  callbackStatusLabel,
} from '@/types';
import {
  BUSINESS_TIME_ZONE,
  CALLBACK_SLA_SECONDS,
  type ReportCallbackRow,
  type ReportCallRow,
  type TelephonyReport,
  type TelephonyReportCallbacks,
} from './reports';

/** Excel en español separa por punto y coma. */
export const CSV_DELIMITER = ';';

const BOM = '\uFEFF';

export type ExportDataset = 'calls' | 'callbacks' | 'agents' | 'summary';

export const EXPORT_DATASETS: {
  value: ExportDataset;
  label: string;
  file: string;
}[] = [
  { value: 'calls', label: 'Llamadas', file: 'llamadas' },
  { value: 'callbacks', label: 'Devoluciones', file: 'devoluciones' },
  { value: 'agents', label: 'Agentes', file: 'agentes' },
  { value: 'summary', label: 'Resumen', file: 'resumen' },
];

export function isExportDataset(value: unknown): value is ExportDataset {
  return EXPORT_DATASETS.some((dataset) => dataset.value === value);
}

/**
 * Una celda. `null`/`undefined` quedan vacíos (no "null"). Se entrecomilla
 * si trae separador, comillas o saltos de línea.
 */
export function csvCell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  // Inyección de fórmulas: Excel ejecuta `=…`, `@…` o lo que empiece
  // por tabulador. Se antepone un apóstrofo (queda como texto).
  const safe = /^[=@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (
    safe.includes(CSV_DELIMITER) ||
    safe.includes('"') ||
    safe.includes('\n') ||
    safe.includes('\r')
  ) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** Documento completo con BOM y CRLF (lo que espera Excel en Windows). */
export function csvDocument(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(csvCell).join(CSV_DELIMITER),
    ...rows.map((row) => row.map(csvCell).join(CSV_DELIMITER)),
  ];
  return `${BOM}${lines.join('\r\n')}`;
}

/** `2026-11-19 13:45` en hora de Venezuela; vacío si la fecha no sirve. */
export function businessDateTime(
  iso: string | null | undefined,
  timeZone: string = BUSINESS_TIME_ZONE
): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return `${pick('year')}-${pick('month')}-${pick('day')} ${hour}:${pick('minute')}`;
}

/** Segundos enteros o vacío; nunca inventa un 0 donde no hay dato. */
export function secondsCell(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(Math.max(0, Math.round(value)));
}

function percentCell(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return `${Math.round(value * 100)}%`;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Admin',
  agent: 'Agente',
  viewer: 'Espectador',
};

function roleLabel(role: string | null | undefined): string {
  if (!role) return '';
  return ROLE_LABELS[role] ?? role;
}

function transcriptLabel(status: string | null | undefined): string {
  if (!status) return '';
  return (
    CALL_TRANSCRIPT_STATUSES.find((item) => item.value === status)?.label ?? status
  );
}

function waitSeconds(row: {
  direction: string;
  started_at: string;
  answered_at: string | null;
}): number | null {
  if (row.direction !== 'inbound' || !row.answered_at) return null;
  const started = Date.parse(row.started_at);
  const answered = Date.parse(row.answered_at);
  if (!Number.isFinite(started) || !Number.isFinite(answered)) return null;
  if (answered < started) return null;
  return (answered - started) / 1000;
}

function elapsedSeconds(
  from: string | null | undefined,
  to: string | null | undefined
): number | null {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 1000;
}

// ------------------------------------------------------------
// 1. Llamadas (una fila por sesión)
// ------------------------------------------------------------

export interface CallExportRow extends ReportCallRow {
  from_number?: string | null;
  to_number?: string | null;
  contact_name?: string | null;
  agent_name?: string | null;
}

export function buildCallsCsv(rows: readonly CallExportRow[]): string {
  const headers = [
    'Inicio (VE)',
    'Dirección',
    'Estado',
    'Desde',
    'Hacia',
    'Contacto',
    'Agente',
    'Espera (s)',
    'Duración (s)',
    'Disposición',
    'Grabación',
    'Transcripción',
    'Fin (VE)',
  ];
  const body = rows.map((row) => [
    businessDateTime(row.started_at),
    callDirectionLabel(row.direction),
    callSessionStatusLabel(row.status),
    row.from_number ?? '',
    row.to_number ?? '',
    row.contact_name ?? '',
    row.agent_name ?? '',
    secondsCell(waitSeconds(row)),
    secondsCell(row.duration_seconds),
    callDispositionLabel(row.disposition),
    row.recording_url ? 'Sí' : 'No',
    transcriptLabel(row.transcript_status),
    businessDateTime(row.ended_at),
  ]);
  return csvDocument(headers, body);
}

// ------------------------------------------------------------
// 2. Devoluciones (una fila por solicitud)
// ------------------------------------------------------------

export interface CallbackExportRow extends ReportCallbackRow {
  phone?: string | null;
  note?: string | null;
  contact_name?: string | null;
  agent_name?: string | null;
  completed_by_name?: string | null;
  call_session_id?: string | null;
}

function slaCell(row: CallbackExportRow): string {
  const response = elapsedSeconds(row.created_at, row.claimed_at);
  if (response == null) return 'Sin reclamar';
  return response <= CALLBACK_SLA_SECONDS ? 'A tiempo' : 'Fuera de SLA';
}

export function buildCallbacksCsv(rows: readonly CallbackExportRow[]): string {
  const headers = [
    'Creada (VE)',
    'Estado',
    'Motivo',
    'Teléfono',
    'Contacto',
    'Agente',
    'Reclamada (VE)',
    'Atendida por',
    'Cerrada (VE)',
    'Respuesta (s)',
    'Resolución (s)',
    'SLA',
    'Nota',
    'Llamada origen',
  ];
  const body = rows.map((row) => [
    businessDateTime(row.created_at),
    callbackStatusLabel(row.status),
    callbackReasonLabel(row.reason),
    row.phone ?? '',
    row.contact_name ?? '',
    row.agent_name ?? '',
    businessDateTime(row.claimed_at),
    row.completed_by_name ?? '',
    businessDateTime(row.completed_at),
    secondsCell(elapsedSeconds(row.created_at, row.claimed_at)),
    secondsCell(elapsedSeconds(row.created_at, row.completed_at)),
    slaCell(row),
    row.note ?? '',
    row.source_call_id ?? '',
  ]);
  return csvDocument(headers, body);
}

// ------------------------------------------------------------
// 3. Agentes (agregado del periodo)
// ------------------------------------------------------------

export function buildAgentsCsv(report: TelephonyReport): string {
  const headers = [
    'Agente',
    'Rol',
    'Llamadas',
    'Contestadas',
    'Perdidas',
    'Tiempo hablado (s)',
    'Duración media (s)',
    'QA',
    'Evaluaciones QA',
    'QA IA',
    'Evaluaciones IA',
  ];
  const body = (report.agents ?? []).map((agent) => [
    agent.name,
    roleLabel(agent.role),
    agent.total,
    agent.answered,
    agent.missed,
    agent.talkSeconds,
    secondsCell(agent.avgHandleSeconds),
    agent.qaScore ?? '',
    agent.qaCount ?? 0,
    agent.aiQaScore ?? '',
    agent.aiQaCount ?? 0,
  ]);
  return csvDocument(headers, body);
}

// ------------------------------------------------------------
// 4. Resumen (una fila por indicador)
// ------------------------------------------------------------

export function buildSummaryCsv(
  report: TelephonyReport,
  callbacks?: TelephonyReportCallbacks
): string {
  const totals = report.totals;
  const rows: unknown[][] = [
    ['Desde', report.from],
    ['Hasta', report.to],
    ['Días', report.days],
    ['Zona horaria', report.timezone],
    ['Llamadas', totals.total],
    ['Entrantes', totals.inbound],
    ['Salientes', totals.outbound],
    ['Contestadas', totals.answered],
    ['Nivel de servicio', percentCell(totals.answerRate)],
    ['Perdidas', totals.missed],
    ['Fallidas', totals.failed],
    ['Canceladas', totals.cancelled],
    ['Tasa de abandono', percentCell(totals.abandonmentRate)],
    ['Espera media (s)', secondsCell(totals.avgWaitSeconds)],
    ['Duración media (s)', secondsCell(totals.avgHandleSeconds)],
    ['Tiempo hablado (s)', totals.talkSeconds],
    ['Tiempo de cierre (s)', secondsCell(totals.avgWrapUpSeconds)],
    ['Grabadas', totals.recorded],
    ['Transcritas', totals.transcribed],
    ['Evaluaciones QA', totals.qaCount ?? 0],
    ['QA promedio', totals.avgQaScore ?? ''],
    ['Cobertura QA', percentCell(totals.qaCoverage)],
    ['Evaluaciones IA', totals.aiQaCount ?? 0],
    ['QA IA promedio', totals.aiAvgQaScore ?? ''],
  ];

  if (callbacks) {
    rows.push(
      ['Devoluciones', callbacks.total],
      ['Devoluciones abiertas', callbacks.pending + callbacks.inProgress],
      ['Devoluciones atendidas', callbacks.done],
      ['Devoluciones canceladas', callbacks.cancelled],
      ['Devoluciones manuales', callbacks.manual],
      ['Respuesta media devolución (s)', secondsCell(callbacks.avgResponseSeconds)],
      ['Resolución media devolución (s)', secondsCell(callbacks.avgResolutionSeconds)],
      ['Recuperación devoluciones', percentCell(callbacks.recoveryRate)],
      ['SLA devoluciones', percentCell(callbacks.slaCompliance)],
      ['Objetivo SLA devolución (s)', callbacks.slaTargetSeconds],
      ['Devoluciones evaluadas por SLA', callbacks.slaEligible],
      ['Devoluciones dentro del SLA', callbacks.slaMet]
    );
  }

  return csvDocument(['Indicador', 'Valor'], rows);
}

// ------------------------------------------------------------
// 5. Nombre del archivo
// ------------------------------------------------------------

export function exportFileName(
  dataset: ExportDataset,
  options: { days: number; day: string }
): string {
  const file =
    EXPORT_DATASETS.find((item) => item.value === dataset)?.file ?? dataset;
  const day = options.day || 'reporte';
  const days = Math.max(1, Math.floor(options.days));
  return `reporte-${file}-${day}-${days}d.csv`;
}
