"use client";

// ============================================================
// Mapa de calor 7×24 (día de la semana × hora) — Métricas.
//
// Presentacional y reutilizable: recibe una matriz [7][24] y pinta la
// intensidad de cada celda con el color indicado. Cada celda con datos
// muestra además el número de mensajes, en blanco o en oscuro según
// cuál dé más contraste sobre su propio color. Se usa para las "horas
// pico" de mensajes entrantes y salientes.
// ============================================================

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

const ROW_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function hourLabel(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

// Fondo de la tarjeta (`--card`) aproximado en sRGB. Sirve para componer
// el color translúcido de la celda y decidir si el número se lee mejor
// en blanco o en oscuro.
const CARD_BG: Record<string, [number, number, number]> = {
  dark: [24, 26, 34],
  light: [255, 255, 255],
};

/** Luminancia relativa (WCAG) de un color sRGB. */
function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

interface HeatmapProps {
  /** Matriz [7][24] — filas lunes→domingo, columnas 0..23 h. */
  matrix: number[][];
  /** Color base (r, g, b) para la intensidad. */
  rgb: [number, number, number];
  className?: string;
}

export function Heatmap({ matrix, rgb, className }: HeatmapProps) {
  const { mode } = useTheme();

  let max = 0;
  for (const row of matrix) for (const v of row) if (v > max) max = v;
  const [r, g, b] = rgb;
  const cardBg = CARD_BG[mode] ?? CARD_BG.dark;

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

            // Componer el color de la celda sobre la tarjeta y elegir el
            // color de texto (claro u oscuro) con mayor contraste.
            const [br, bg, bb] = cardBg;
            const cr = br * (1 - intensity) + r * intensity;
            const cg = bg * (1 - intensity) + g * intensity;
            const cb = bb * (1 - intensity) + b * intensity;
            const lum = relativeLuminance(cr, cg, cb);
            const darkTextWins = (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05);

            return (
              <div
                key={h}
                title={`${label} ${hourLabel(h)} · ${value} mensaje(s)`}
                className={cn(
                  "flex h-5 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[3px] border border-border/40 text-[9px] leading-none font-medium tabular-nums",
                  value > 0 && darkTextWins ? "text-slate-900" : "text-white",
                )}
                style={
                  value > 0
                    ? {
                        backgroundColor: `rgba(${r}, ${g}, ${b}, ${intensity})`,
                      }
                    : undefined
                }
              >
                {value > 0 ? value : ""}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
