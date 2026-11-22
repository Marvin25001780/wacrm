import { MessageCircle } from "lucide-react";

import { slaLevel, waitingLabel, type SlaLevel } from "@/lib/collections/response";
import { cn } from "@/lib/utils";

const TONE: Record<SlaLevel, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  late: "border-red-500/40 bg-red-500/10 text-red-300",
};

/**
 * 129 — chip de respuesta pendiente con su antigüedad y el color del
 * SLA. No dibuja nada si no hay espera (`minutes` nulo), así el mismo
 * componente sirve en la cola y en la ficha.
 */
export function WaitBadge({
  minutes,
  slaMinutes,
  label = "Respondió",
  className,
}: {
  minutes: number | null | undefined;
  slaMinutes?: number;
  label?: string;
  className?: string;
}) {
  const level = slaLevel(minutes, slaMinutes);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium",
        level === null
          ? "border-primary/40 bg-primary/10 text-primary"
          : TONE[level],
        className,
      )}
      title={
        level === null
          ? "Respondió por WhatsApp; el tiempo llegará al aplicar la migración 129"
          : level === "late"
            ? "Fuera del SLA de primera respuesta"
            : level === "warn"
              ? "Cerca del SLA de primera respuesta"
              : "Dentro del SLA de primera respuesta"
      }
    >
      <MessageCircle className="h-3 w-3" />
      {label}
      {level === null ? "" : ` · ${waitingLabel(minutes)}`}
    </span>
  );
}
