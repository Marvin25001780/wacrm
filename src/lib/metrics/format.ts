// ============================================================
// Formateo de valores del módulo de Métricas.
// ============================================================

/** Formatea una duración en minutos: "<1 min", "42 min", "3 h 5 min". */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min < 0) return "—";
  if (min < 1) return "<1 min";
  if (min < 60) return `${Math.round(min)} min`;
  const hours = Math.floor(min / 60);
  const mins = Math.round(min % 60);
  if (mins === 0) return `${hours} h`;
  return `${hours} h ${mins} min`;
}

/** Formatea el promedio de CSAT: "4.3 / 5". */
export function formatScore(avg: number | null | undefined): string {
  if (avg == null || !Number.isFinite(avg)) return "—";
  return `${avg.toFixed(1)} / 5`;
}

/** Formatea una proporción 0..1 como porcentaje: "42.5 %". */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toLocaleString("es-ES", {
    maximumFractionDigits: 1,
  })} %`;
}
