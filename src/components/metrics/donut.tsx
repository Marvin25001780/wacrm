"use client";

// ============================================================
// Dona (donut) SVG por CSS conic-gradient — sin dependencias.
//
// Recibe porciones {label, value, color} y pinta el anillo + una
// leyenda. Se usa para la distribución de CSAT (satisfecho / neutral
// / insatisfecho).
// ============================================================

import { cn } from "@/lib/utils";

export interface DonutSlice {
  label: string;
  value: number;
  /** Color CSS (hex o rgb). */
  color: string;
}

export function Donut({
  slices,
  centerLabel,
  centerSub,
  className,
}: {
  slices: DonutSlice[];
  centerLabel?: string;
  centerSub?: string;
  className?: string;
}) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);

  // Construye el conic-gradient; si no hay datos, un anillo gris.
  let cursor = 0;
  const stops: string[] = [];
  for (const s of slices) {
    const value = Math.max(0, s.value);
    const start = total > 0 ? (cursor / total) * 100 : 0;
    cursor += value;
    const end = total > 0 ? (cursor / total) * 100 : 0;
    stops.push(`${s.color} ${start}% ${end}%`);
  }
  const gradient =
    total > 0
      ? `conic-gradient(${stops.join(", ")})`
      : "conic-gradient(var(--muted) 0% 100%)";

  return (
    <div className={cn("flex flex-wrap items-center gap-6", className)}>
      <div
        className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-full"
        style={{ background: gradient }}
      >
        <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-card text-center">
          <span className="text-xl font-bold tabular-nums text-foreground">
            {centerLabel ?? "—"}
          </span>
          {centerSub && (
            <span className="text-[10px] text-muted-foreground">{centerSub}</span>
          )}
        </div>
      </div>

      <ul className="space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-medium tabular-nums text-foreground">
              {s.value.toLocaleString("es-ES")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
