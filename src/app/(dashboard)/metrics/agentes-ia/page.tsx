"use client";

import { SectionPlaceholder } from "@/components/metrics/section-placeholder";

export default function AgentesIaMetricsPage() {
  return (
    <SectionPlaceholder
      title="Agentes IA"
      description="Cómo trabajan tus agentes de IA y cuánto cuestan."
      bullets={[
        "Desglose de motivos de salida y tasa de objetivo alcanzado.",
        "Conversaciones atendidas y mensajes generados.",
        "Costo total y por conversación.",
      ]}
    />
  );
}
