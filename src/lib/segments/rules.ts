import type {
  SegmentEntity,
  SegmentOperator,
  SegmentRule,
} from '@/types'

// ============================================================
// Motor de reglas de segmentación — puro, sin I/O.
//
// Un segmento es un arreglo plano de condiciones (AND). Aquí se valida
// contra un catálogo de campos permitidos y se "compila" a una lista de
// filtros neutrales que las rutas aplican a Supabase. Mantenerlo puro
// permite reutilizarlo en el navegador (UI) y en el servidor (API) y
// testearlo sin red.
// ============================================================

export interface SegmentFieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date';
  operators: SegmentOperator[];
  /** Sugerencias de valor (p. ej. estados de lead) para el constructor. */
  options?: string[];
}

const TEXT_OPS: SegmentOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'starts_with',
  'is_set',
  'is_not_set',
];

const NUMBER_OPS: SegmentOperator[] = ['equals', 'gt', 'lt', 'is_set', 'is_not_set'];

export const SEGMENT_FIELDS: Record<SegmentEntity, SegmentFieldDef[]> = {
  contacts: [
    { key: 'name', label: 'Nombre', type: 'text', operators: TEXT_OPS },
    { key: 'phone', label: 'Teléfono', type: 'text', operators: TEXT_OPS },
    { key: 'email', label: 'Correo', type: 'text', operators: TEXT_OPS },
    { key: 'company', label: 'Empresa', type: 'text', operators: TEXT_OPS },
    { key: 'source', label: 'Origen', type: 'text', operators: TEXT_OPS },
    {
      key: 'created_at',
      label: 'Fecha de alta',
      type: 'date',
      operators: ['gt', 'lt'],
    },
  ],
  leads: [
    { key: 'name', label: 'Nombre', type: 'text', operators: TEXT_OPS },
    { key: 'phone', label: 'Teléfono', type: 'text', operators: TEXT_OPS },
    { key: 'email', label: 'Correo', type: 'text', operators: TEXT_OPS },
    { key: 'company', label: 'Empresa', type: 'text', operators: TEXT_OPS },
    {
      key: 'status',
      label: 'Estado',
      type: 'text',
      operators: ['equals', 'not_equals', 'is_set', 'is_not_set'],
      options: ['new', 'contacted', 'qualified', 'unqualified', 'converted'],
    },
    { key: 'source', label: 'Origen', type: 'text', operators: TEXT_OPS },
    {
      key: 'value',
      label: 'Valor',
      type: 'number',
      operators: NUMBER_OPS,
    },
    {
      key: 'created_at',
      label: 'Fecha de alta',
      type: 'date',
      operators: ['gt', 'lt'],
    },
  ],
}

export const OPERATOR_LABEL: Record<SegmentOperator, string> = {
  equals: 'es igual a',
  not_equals: 'es distinto de',
  contains: 'contiene',
  starts_with: 'empieza con',
  gt: 'es mayor que',
  lt: 'es menor que',
  is_set: 'tiene valor',
  is_not_set: 'está vacío',
}

export const MAX_RULES = 8;

export function fieldsFor(entity: SegmentEntity): SegmentFieldDef[] {
  return SEGMENT_FIELDS[entity] ?? []
}

export function fieldDef(
  entity: SegmentEntity,
  key: string,
): SegmentFieldDef | undefined {
  return fieldsFor(entity).find((f) => f.key === key)
}

function needsValue(op: SegmentOperator): boolean {
  return op !== 'is_set' && op !== 'is_not_set'
}

/** Valida un arreglo de reglas contra el catálogo de campos. */
export function validateRules(
  entity: SegmentEntity,
  rules: unknown,
): { ok: true; rules: SegmentRule[] } | { ok: false; error: string } {
  if (!Array.isArray(rules)) return { ok: false, error: 'rules debe ser un arreglo' }
  if (rules.length > MAX_RULES) {
    return { ok: false, error: `Máximo ${MAX_RULES} condiciones por segmento` }
  }
  const out: SegmentRule[] = []
  for (const raw of rules) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'Cada condición debe ser un objeto' }
    }
    const r = raw as Record<string, unknown>
    const field = typeof r.field === 'string' ? r.field : ''
    const operator = typeof r.operator === 'string' ? (r.operator as SegmentOperator) : ('' as SegmentOperator)
    const def = fieldDef(entity, field)
    if (!def) return { ok: false, error: `Campo desconocido: ${field}` }
    if (!def.operators.includes(operator)) {
      return { ok: false, error: `Operador no válido para ${def.label}` }
    }
    const value = typeof r.value === 'string' ? r.value.trim() : r.value == null ? '' : String(r.value)
    if (needsValue(operator) && !value) {
      return { ok: false, error: `Falta el valor para "${def.label}"` }
    }
    out.push({ field, operator, value })
  }
  return { ok: true, rules: out }
}

// ------------------------------------------------------------
// Compilación a filtros neutrales
// ------------------------------------------------------------

export type FilterMethod = 'eq' | 'neq' | 'ilike' | 'gt' | 'lt' | 'is' | 'not_is';

export interface CompiledFilter {
  method: FilterMethod;
  column: string;
  value: string | null;
}

/** Traduce reglas validadas a una lista de filtros aplicables. */
export function compileRules(
  entity: SegmentEntity,
  rules: SegmentRule[],
): CompiledFilter[] {
  const filters: CompiledFilter[] = []
  for (const rule of rules) {
    const def = fieldDef(entity, rule.field)
    if (!def) continue
    const v = rule.value ?? ''
    switch (rule.operator) {
      case 'equals':
        filters.push({ method: 'eq', column: rule.field, value: v })
        break
      case 'not_equals':
        filters.push({ method: 'neq', column: rule.field, value: v })
        break
      case 'contains':
        filters.push({ method: 'ilike', column: rule.field, value: `%${v}%` })
        break
      case 'starts_with':
        filters.push({ method: 'ilike', column: rule.field, value: `${v}%` })
        break
      case 'gt':
        filters.push({ method: 'gt', column: rule.field, value: v })
        break
      case 'lt':
        filters.push({ method: 'lt', column: rule.field, value: v })
        break
      case 'is_set':
        filters.push({ method: 'not_is', column: rule.field, value: null })
        break
      case 'is_not_set':
        filters.push({ method: 'is', column: rule.field, value: null })
        break
    }
  }
  return filters
}

/** Resume las reglas en texto legible (para listados y CSV). */
export function describeRules(entity: SegmentEntity, rules: SegmentRule[]): string {
  if (rules.length === 0) return 'Todos'
  return rules
    .map((r) => {
      const def = fieldDef(entity, r.field)
      const label = def?.label ?? r.field
      const op = OPERATOR_LABEL[r.operator] ?? r.operator
      return needsValue(r.operator) ? `${label} ${op} "${r.value}"` : `${label} ${op}`
    })
    .join(' Y ')
}
