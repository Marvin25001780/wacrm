// ============================================================
// Motivos de cierre de conversación.
//
// Catálogo compartido entre la Bandeja (diálogo de cierre) y el
// reporte de Métricas → Conversaciones. El valor se guarda tal cual
// en `conversations.close_reason` (TEXT), de modo que "Otro" y los
// textos personalizados aparecen también en el desglose del reporte.
// ============================================================

export const CLOSE_REASONS = [
  'Resuelto',
  'Sin respuesta del cliente',
  'Seguimiento pendiente',
  'Derivado a otra área',
  'Spam / no deseado',
  'Duplicado',
] as const;

export type CloseReason = (typeof CLOSE_REASONS)[number];

/** Opción "Otro" — muestra un campo de texto libre. */
export const CLOSE_REASON_OTHER = 'Otro motivo';
