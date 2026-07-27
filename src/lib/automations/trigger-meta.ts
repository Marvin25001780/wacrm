import type { AutomationTriggerType } from '@/types'

export interface TriggerMeta {
  label: string
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string
}

export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    label: 'Nuevo Mensaje',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  first_inbound_message: {
    label: 'Primer Mensaje del Contacto',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  keyword_match: {
    label: 'Coincidencia de Palabra Clave',
    pillClass: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  },
  new_contact_created: {
    label: 'Nuevo Contacto',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  conversation_assigned: {
    label: 'Conversaci\u00f3n Asignada',
    pillClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
  tag_added: {
    label: 'Etiqueta Agregada',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  time_based: {
    label: 'Basado en Tiempo',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
  },
}

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      label: t,
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
    }
  )
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'nunca'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'nunca'
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return 'ahora mismo'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m atr\u00e1s`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h atr\u00e1s`
  if (diffSec < 2_592_000) return `${Math.floor(diffSec / 86400)}d atr\u00e1s`
  return new Date(iso).toLocaleDateString()
}
