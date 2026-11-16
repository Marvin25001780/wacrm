// ============================================================
// Habilidades del agente y desbordamiento por habilidad (ACD v2).
//
// Lógica pura, sin base de datos ni LiveKit, para poder probarla:
//   * qué habilidades se guardan (normalización),
//   * si un agente puede tomar una entrante,
//   * cuándo se levanta el requisito (desbordamiento).
//
// Regla de negocio:
//   - Una llamada sin `required_skills` entra a cualquier agente.
//   - Si exige habilidades, solo la ven los agentes que las tengan
//     todas (no vale tener una de dos).
//   - Si el negocio configuró desbordamiento y nadie con esas
//     habilidades la tomó en N segundos, el requisito se levanta y
//     la llamada pasa a cualquier agente disponible.
// ============================================================

/** Tope de habilidades por agente y por cola (coincide con el CHECK). */
export const MAX_SKILLS = 8;

/** Longitud máxima de una habilidad (coincide con la RPC). */
export const MAX_SKILL_LENGTH = 30;

/** Tope del desbordamiento por habilidad, en segundos. */
export const MAX_SKILL_OVERFLOW_SECONDS = 3600;

/**
 * Normaliza una habilidad: recorta, minúsculas y espacios colapsados.
 * Devuelve `null` si queda vacía o supera el máximo.
 */
export function normalizeSkill(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!clean || clean.length > MAX_SKILL_LENGTH) return null;
  return clean;
}

export interface NormalizedSkills {
  /** Habilidades válidas, sin duplicados y en el orden recibido. */
  skills: string[];
  /** Entradas descartadas (vacías, demasiado largas o no texto). */
  rejected: string[];
  /** Cuántas habilidades válidas quedaron fuera por el tope. */
  overflow: number;
}

/**
 * Normaliza una lista de habilidades venida de la API o de la base.
 * Acepta arrays o una cadena separada por comas (comodidad del
 * formulario). Nunca lanza: descarta lo inválido y lo reporta.
 */
export function normalizeSkillList(
  input: unknown,
  limit: number = MAX_SKILLS
): NormalizedSkills {
  const raw: unknown[] = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  const skills: string[] = [];
  const rejected: string[] = [];
  let overflow = 0;

  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim() === '') continue;
    const skill = normalizeSkill(entry);
    if (!skill) {
      rejected.push(String(entry));
      continue;
    }
    if (skills.includes(skill)) continue;
    if (skills.length >= limit) {
      overflow += 1;
      continue;
    }
    skills.push(skill);
  }

  return { skills, rejected, overflow };
}

/** Lista legible para la UI: `ventas, soporte`. */
export function formatSkillList(skills: string[] | null | undefined): string {
  return (skills ?? []).join(', ');
}

/**
 * ¿Este agente puede tomar la llamada?
 *
 * `required_skills` vacío = sin requisito. Con `overflowed_at` el
 * requisito ya se levantó. Si no, el agente necesita TODAS.
 */
export function agentCanTakeCall(
  call: {
    required_skills?: string[] | null;
    overflowed_at?: string | null;
  },
  agentSkills: string[] | null | undefined
): boolean {
  const required = call.required_skills ?? [];
  if (required.length === 0) return true;
  if (call.overflowed_at) return true;

  const owned = new Set(
    (agentSkills ?? [])
      .map((skill) => normalizeSkill(skill))
      .filter((skill): skill is string => Boolean(skill))
  );

  return required.every((skill) => {
    const normalized = normalizeSkill(skill) ?? skill;
    return owned.has(normalized);
  });
}

/** Habilidades que le faltan al agente para esta llamada. */
export function missingSkills(
  call: { required_skills?: string[] | null; overflowed_at?: string | null },
  agentSkills: string[] | null | undefined
): string[] {
  const required = call.required_skills ?? [];
  if (required.length === 0 || call.overflowed_at) return [];
  const owned = new Set(
    (agentSkills ?? [])
      .map((skill) => normalizeSkill(skill))
      .filter((skill): skill is string => Boolean(skill))
  );
  return required.filter((skill) => !owned.has(normalizeSkill(skill) ?? skill));
}

/**
 * Valida los segundos de desbordamiento del negocio: entero 0..3600.
 * `0` = desactivado. Devuelve `null` si el valor no sirve.
 */
export function normalizeSkillOverflowSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > MAX_SKILL_OVERFLOW_SECONDS) {
    return null;
  }
  return n;
}

/** ¿Ya toca levantar el requisito de habilidad? */
export function isSkillOverflowDue(args: {
  startedAt: string;
  overflowSeconds: number;
  /** Reloj inyectable para tests. */
  now?: number;
}): boolean {
  const seconds = args.overflowSeconds ?? 0;
  if (seconds <= 0) return false;
  const started = new Date(args.startedAt).getTime();
  const now = args.now ?? Date.now();
  if (Number.isNaN(started) || Number.isNaN(now)) return false;
  return Math.floor((now - started) / 1000) >= seconds;
}
