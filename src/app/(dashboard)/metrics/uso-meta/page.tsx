"use client";

import { SectionPlaceholder } from "@/components/metrics/section-placeholder";

export default function UsoMetaMetricsPage() {
  return (
    <SectionPlaceholder
      title="Uso de Meta"
      description="Mensajes y costos de WhatsApp Cloud API por categoría."
      bullets={[
        "Mensajes por categoría (Marketing, Utilidad, Autenticación y Servicio).",
        "Costo total y por categoría, incluidos llamadas y Legacy.",
        "Puntos de entrada gratuitos.",
        "Porcentaje de mensajes seguidos por agente.",
      ]}
    />
  );
}
