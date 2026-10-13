"use client";

import { SectionPlaceholder } from "@/components/metrics/section-placeholder";

export default function LlamadasMetricsPage() {
  return (
    <SectionPlaceholder
      title="Llamadas"
      description="Volumen, duración y resultado de las llamadas entrantes y salientes."
      bullets={[
        "KPIs: totales, duración media y tasa de fallidas.",
        "Gráfico de llamadas en el tiempo.",
        "Mapa de horas pico de llamadas.",
        "Tablas por agente y equipo (con exportación CSV).",
        "Registro de llamadas.",
      ]}
    />
  );
}
