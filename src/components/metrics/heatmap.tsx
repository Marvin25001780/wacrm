"use client";

// ============================================================
// Mapa de calor 7×24 (día de la semana × hora) — Métricas.
//
// Presentacional y reutilizable: recibe una matriz [7][24] y pinta la
// intensidad de cada celda con el color indicado. Se usa para las
// "horas pico" de mensajes entrantes y salientes.
// ============================================================

import { cn } from "@/lib/utils";

const ROW_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function hourLabel(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

interface HeatmapProps {
  /** Matriz [7][24] — filas lunes→domingo, columnas 0..23 h. */
  matrix: number[][];
  /** Color base (r, g, b) para la intensidad. */
  rgb: [number, number, number];
  className?: string;
}

export function Heatmap({ matrix, rgb, className }: HeatmapProps) {
  let max = 0;
  for (const row of matrix) for (const v of row) if (v > max) max = v;
  const [r, g, b] = rgb;

  return (
    <div className={cn("space-y-1", className)}>
      {/* Cabecera de horas */}
      <div className="flex items-center gap-1 pl-8">
        {Array.from({ length: 24 }).map((_, h) => (
          <div
            key={h}
            className="flex-1 text-center text-[9px] text-muted-foreground"
          >
            {h % 2 === 0 ? hourLabel(h) : ""}
          </div>
        ))}
      </div>

      {ROW_LABELS.map((label, dow) => (
        <div key={label} className="flex items-center gap-1">
          <div className="w-7 shrink-0 text-right text-[10px] text-muted-foreground">
            {label}
          </div>
          {Array.from({ length: 24 }).map((_, h) => {
            const value = matrix[dow]?.[h] ?? 0;
            const intensity = max > 0 ? 0.08 + (value / max) * 0.82 : 0;
            return (
              <div
                key={h}
                title={`${label} ${hourLabel(h)} · ${value} mensaje(s)`}
                className="h-5 flex-1 rounded-[3px] border border-border/40"
                style={
                  value > 0
                    ? {
                        backgroundColor: `rgba(${r}, ${g}, ${b}, ${intensity})`,
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
