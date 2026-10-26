import type { Metadata } from "next";
import { LegalShell, type LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Estado del sistema — NEXUS BPO",
  description:
    "Estado de los servicios de Nexus CRM: plataforma, bandeja, canales, IA y cobranza. Incidencias y mantenimientos.",
};

const SERVICES = [
  {
    name: "Aplicación web y panel",
    detail: "Inicio de sesión, navegación y módulos administrativos",
  },
  {
    name: "Bandeja de entrada",
    detail: "Recepción y envío de mensajes en tiempo real",
  },
  {
    name: "Canales conectados",
    detail: "WhatsApp, Messenger, Instagram y TikTok (según plataforma)",
  },
  {
    name: "Automatizaciones y agentes de IA",
    detail: "Flujos, respuestas automáticas y clasificación",
  },
  {
    name: "Cobranza",
    detail: "Cartera, pagos, reportes e importaciones",
  },
  {
    name: "API y webhooks",
    detail: "Integraciones externas y entrega de eventos",
  },
];

const SECTIONS: LegalSection[] = [
  {
    title: "Cómo leer esta página",
    paragraphs: [
      "El estado refleja la disponibilidad de nuestros servicios principales. Una incidencia en una plataforma externa (Meta, TikTok o un proveedor de infraestructura) puede afectar un canal aunque nuestros servicios estén operativos.",
      "Actualizamos esta página cuando detectamos o resolvemos un incidente relevante.",
    ],
  },
  {
    title: "Mantenimientos programados",
    paragraphs: [
      "Los mantenimientos que requieran interrupción se anuncian con antelación por correo a los administradores de cada organización. Procuramos realizarlos en horario de baja actividad (madrugada, hora de Caracas).",
    ],
  },
  {
    title: "Reportar una incidencia",
    paragraphs: [
      "Si algo no funciona como se describe arriba, escríbenos a contacto@nexusbpo.space con el asunto “Incidencia”, indicando la organización, el módulo afectado, la hora aproximada y una captura si es posible.",
      "Respondemos según la severidad: los problemas que impiden operar tienen prioridad sobre dudas de uso.",
    ],
  },
];

export default function EstadoDelSistemaPage() {
  return (
    <LegalShell
      title="Estado del sistema"
      updated="26 de octubre de 2026"
      current="/estado-del-sistema"
      intro="Disponibilidad de los servicios de Nexus CRM e información para reportar incidencias."
      sections={SECTIONS}
    >
      <section className="mt-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="text-sm font-semibold text-foreground">
              Todos los servicios operativos
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            Última verificación: 26 oct 2026
          </span>
        </div>

        <ul className="divide-y divide-border rounded-xl border border-border">
          {SERVICES.map((service) => (
            <li
              key={service.name}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {service.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {service.detail}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Operativo
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">
          Historial de incidencias
        </h2>
        <p className="mt-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          No hay incidencias registradas en los últimos 30 días.
        </p>
      </section>
    </LegalShell>
  );
}
