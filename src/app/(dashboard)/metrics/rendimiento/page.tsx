"use client";

import { SectionPlaceholder } from "@/components/metrics/section-placeholder";

export default function RendimientoMetricsPage() {
  return (
    <SectionPlaceholder
      title="Rendimiento"
      description="Tiempos de primera respuesta, respuesta y cierre, más satisfacción (CSAT)."
      bullets={[
        "Gráfico de tiempo de primera respuesta, tiempo de respuesta y tiempo de cierre.",
        "CSAT: puntuación y distribución de la satisfacción.",
        "Rendimiento por agente y por equipo.",
        "Registros de estado de los agentes.",
      ]}
    />
  );
}
