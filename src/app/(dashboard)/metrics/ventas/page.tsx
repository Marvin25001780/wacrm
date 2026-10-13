"use client";

import { SectionPlaceholder } from "@/components/metrics/section-placeholder";

export default function VentasMetricsPage() {
  return (
    <SectionPlaceholder
      title="Ventas"
      description="Ventas y cotizaciones: cuánto se vendió, cuánto se cotizó y a qué ritmo."
      bullets={[
        "KPIs: número de ventas, monto vendido, número de cotizaciones y monto cotizado.",
        "Rendimiento de ventas y de cotizaciones.",
        "Tablas por agente, equipo y producto (con exportación CSV).",
        "Registro de ventas y cotizaciones.",
      ]}
    />
  );
}
