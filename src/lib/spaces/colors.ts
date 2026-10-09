// ============================================================
// Paleta de colores para Espacios de trabajo (migration 036).
// Cada espacio guarda un token; aquí se resuelve a clases
// Tailwind para el punto y el chip. Pura — sin dependencias.
// ============================================================

export interface SpaceColor {
  value: string;
  label: string;
  /** Clase para el punto/indicador de color. */
  dot: string;
  /** Clases para un chip/badge tintado. */
  chip: string;
}

export const SPACE_COLORS: SpaceColor[] = [
  {
    value: 'primary',
    label: 'Primario',
    dot: 'bg-primary',
    chip: 'border-primary/40 bg-primary/10 text-primary',
  },
  {
    value: 'sky',
    label: 'Azul',
    dot: 'bg-sky-400',
    chip: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  },
  {
    value: 'violet',
    label: 'Violeta',
    dot: 'bg-violet-400',
    chip: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  },
  {
    value: 'emerald',
    label: 'Verde',
    dot: 'bg-emerald-400',
    chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  },
  {
    value: 'amber',
    label: 'Ámbar',
    dot: 'bg-amber-400',
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  {
    value: 'rose',
    label: 'Rosa',
    dot: 'bg-rose-400',
    chip: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  },
];

/** Resuelve un token de color; cae al primero si es desconocido. */
export function spaceColor(value?: string | null): SpaceColor {
  return SPACE_COLORS.find((c) => c.value === value) ?? SPACE_COLORS[0];
}
