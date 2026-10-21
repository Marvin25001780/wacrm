"use client";

// ============================================================
// Panel de Acciones del agente (A3) — 5 palancas.
// Edita el estado del editor (un solo "Guardar agente" arriba); la
// descripción de cada palanca cuenta QUÉ hará el modelo, para que el
// admin sepa lo que entrega al modelo antes de activarlo.
// ============================================================

import { Tags, ClipboardList, UserRound, CircleSlash, StickyNote } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface AgentActionFlags {
  action_tags: boolean;
  action_fields: boolean;
  action_assign: boolean;
  action_close: boolean;
  action_notes: boolean;
}

const ITEMS: {
  key: keyof AgentActionFlags;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "action_tags", label: "Añadir etiquetas", desc: "Añade una o más etiquetas al contacto (se crean si no existen).", icon: Tags },
  { key: "action_fields", label: "Editar campos del contacto", desc: "Guarda los datos recopilados (nombre, email, empresa).", icon: ClipboardList },
  { key: "action_assign", label: "Asignar un humano", desc: "Pasa la conversación a la bandeja de un agente humano.", icon: UserRound },
  { key: "action_close", label: "Cerrar conversación", desc: "Cierra el chat cuando el objetivo ya se cumplió.", icon: CircleSlash },
  { key: "action_notes", label: "Añadir nota interna", desc: "Escribe una nota privada visible solo para tu equipo.", icon: StickyNote },
];

export function ActionsPanel({
  value,
  onChange,
}: {
  value: AgentActionFlags;
  onChange: (next: AgentActionFlags) => void;
}) {
  const activeCount = ITEMS.filter((i) => value[i.key]).length;

  return (
    <div className="space-y-3">
      {ITEMS.map(({ key, label, desc, icon: Icon }) => (
        <div
          key={key}
          className={cn(
            "flex items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-colors",
            value[key] ? "border-primary/50 bg-primary/5" : "border-border bg-card"
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", value[key] ? "text-primary" : "text-muted-foreground")} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          </div>
          <Switch
            checked={value[key]}
            aria-label={label}
            onCheckedChange={(next) => onChange({ ...value, [key]: next })}
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {activeCount === 0
          ? "Sin acciones: el agente solo conversa."
          : `${activeCount} ${activeCount === 1 ? "acción permitida" : "acciones permitidas"} — se aplican al guardar y solo cuando el cliente lo pide o confirma.`}
      </p>
    </div>
  );
}
