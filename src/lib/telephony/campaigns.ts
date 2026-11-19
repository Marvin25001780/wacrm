// ============================================================
// Campañas salientes (migraciones 117 y 124) — reglas de la cola.
//
// La parte atómica (reclamar, vincular y cerrar un intento) vive en
// las funciones SQL de la 124. Aquí están los cálculos y las
// etiquetas que usa la pantalla, puros y testeables.
// ============================================================

import type {
  CampaignAttemptOutcome,
  OutboundCampaignContact,
  OutboundCampaignContactStatus,
  OutboundCampaignStatus,
} from '@/types';

export const CAMPAIGN_STATUSES: {
  value: OutboundCampaignStatus;
  label: string;
}[] = [
  { value: 'active', label: 'Activa' },
  { value: 'paused', label: 'Pausada' },
  { value: 'completed', label: 'Completada' },
];

export const CAMPAIGN_CONTACT_STATUSES: {
  value: OutboundCampaignContactStatus;
  label: string;
}[] = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'dialing', label: 'Marcando' },
  { value: 'called', label: 'Contactado' },
  { value: 'exhausted', label: 'Sin intentos' },
];

export const CAMPAIGN_OUTCOMES: {
  value: CampaignAttemptOutcome;
  label: string;
}[] = [
  { value: 'answered', label: 'Contestó' },
  { value: 'missed', label: 'No contestó' },
  { value: 'failed', label: 'Falló' },
  { value: 'cancelled', label: 'Cancelada' },
  { value: 'unknown', label: 'Sin dato' },
];

export function campaignStatusLabel(value?: string | null): string {
  if (!value) return '';
  return CAMPAIGN_STATUSES.find((status) => status.value === value)?.label ?? value;
}

export function campaignContactStatusLabel(value?: string | null): string {
  if (!value) return '';
  return (
    CAMPAIGN_CONTACT_STATUSES.find((status) => status.value === value)?.label ??
    value
  );
}

export function campaignOutcomeLabel(value?: string | null): string {
  if (!value) return '';
  return CAMPAIGN_OUTCOMES.find((outcome) => outcome.value === value)?.label ?? value;
}

/** La campaña acepta trabajo nuevo solo cuando está activa. */
export function isCampaignOpen(
  status: OutboundCampaignStatus | string | null | undefined
): boolean {
  return status === 'active';
}

export interface CampaignProgress {
  total: number;
  /** Nunca se ha marcado y todavía puede intentarse. */
  pending: number;
  /** Tiene una llamada en curso ahora mismo. */
  dialing: number;
  /** Contestaron: ya no se vuelve a llamar. */
  called: number;
  /** Se agotaron los intentos sin contestar. */
  exhausted: number;
  /** Cerrados de cualquier forma (called + exhausted). */
  closed: number;
  /** Porcentaje cerrado sobre el total (0–100, entero). */
  percent: number;
  /** Todavía queda algo por hacer (pendiente o marcando). */
  hasWork: boolean;
}

/**
 * Resumen de una campaña. No depende del reloj: `dialing` es lo que
 * dice la base, no se expira aquí (la reserva se barre al reclamar).
 */
export function campaignProgress(
  contacts: readonly Pick<OutboundCampaignContact, 'status'>[] | null | undefined
): CampaignProgress {
  const rows = contacts ?? [];
  let pending = 0;
  let dialing = 0;
  let called = 0;
  let exhausted = 0;

  for (const row of rows) {
    if (row.status === 'pending') pending += 1;
    else if (row.status === 'dialing') dialing += 1;
    else if (row.status === 'called') called += 1;
    else if (row.status === 'exhausted') exhausted += 1;
  }

  const total = rows.length;
  const closed = called + exhausted;

  return {
    total,
    pending,
    dialing,
    called,
    exhausted,
    closed,
    percent: total ? Math.round((closed / total) * 100) : 0,
    hasWork: pending > 0 || dialing > 0,
  };
}

/**
 * Texto corto de intentos para la tabla. `null` cuando el contacto
 * nunca se ha marcado (no se inventa un 0/3 que parezca un intento).
 */
export function attemptsLabel(args: {
  attempts: number;
  maxAttempts: number;
}): string | null {
  const attempts = Math.max(0, Math.floor(args.attempts ?? 0));
  if (attempts === 0) return null;
  const max = Math.max(1, Math.floor(args.maxAttempts ?? 1));
  return `${attempts}/${max}`;
}
