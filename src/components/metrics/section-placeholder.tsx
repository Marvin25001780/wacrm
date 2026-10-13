"use client";

// ============================================================
// Placeholder de secciones del módulo de Métricas que se
// construirán en las siguientes fases (Ventas, Llamadas, Agentes
// IA, Uso de Meta, Widget). Mantiene la navegación funcional y
// describe qué traerá cada sección.
// ============================================================

import { Construction } from "lucide-react";

export function SectionPlaceholder({
  title,
  description,
  bullets,
}: {
  title: string;
  description: string;
  bullets?: string[];
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-8 sm:p-12">
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Construction className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {bullets && bullets.length > 0 && (
          <ul className="mt-5 space-y-1.5 text-left text-sm text-muted-foreground">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                {b}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
          En construcción · siguiente fase
        </p>
      </div>
    </div>
  );
}
