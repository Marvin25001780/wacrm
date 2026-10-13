"use client";

// ============================================================
// Layout del módulo de Métricas.
//
// Provee el contexto de filtros a todas las secciones y coloca la
// sub-navegación + la barra de filtros por encima del contenido.
// Al vivir en el layout, los filtros se mantienen al cambiar de
// sección.
// ============================================================

import { MetricsFilterProvider } from "@/components/metrics/metrics-filter-context";
import { MetricsFilters } from "@/components/metrics/metrics-filters";
import { MetricsSubnav } from "@/components/metrics/metrics-subnav";

export default function MetricsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MetricsFilterProvider>
      <div className="space-y-5">
        <MetricsSubnav />
        <MetricsFilters />
        {children}
      </div>
    </MetricsFilterProvider>
  );
}
