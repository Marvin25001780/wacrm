"use client";

import { SectionPlaceholder } from "@/components/metrics/section-placeholder";

export default function WidgetMetricsPage() {
  return (
    <SectionPlaceholder
      title="Widget"
      description="Rendimiento del widget de chat del sitio web."
      bullets={[
        "Sesiones y conversaciones iniciadas desde el widget.",
        "Tasa de conversión a contacto/lead.",
        "Tiempo de espera y atención.",
      ]}
    />
  );
}
