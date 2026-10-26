import type { Metadata } from "next";
import { LegalShell, type LegalSection } from "@/components/legal/legal-shell";
import { PrintButton } from "@/components/legal/print-button";

export const metadata: Metadata = {
  title: "Acuerdo de tratamiento de datos (DPA) — NEXUS BPO",
  description:
    "Acuerdo de encargo de tratamiento de datos entre el cliente de Nexus CRM y REPRESENTACIONES J.J.D.C, CA.",
};

const SECTIONS: LegalSection[] = [
  {
    title: "1. Partes y roles",
    paragraphs: [
      "El presente Acuerdo de Tratamiento de Datos (el “DPA”) forma parte del contrato de servicio entre REPRESENTACIONES J.J.D.C, CA (“NEXUS BPO”, el “Encargado”) y la organización que contrata Nexus CRM (el “Cliente”, el “Responsable”).",
      "El Cliente determina las finalidades y los medios del tratamiento de los datos personales que carga o genera en la plataforma. NEXUS BPO los trata únicamente por cuenta del Cliente y siguiendo sus instrucciones documentadas.",
    ],
  },
  {
    title: "2. Objeto y duración",
    paragraphs: [
      "El Encargado tratará datos personales para prestar los servicios de gestión de comunicaciones, contactos, oportunidades, automatizaciones y cobranza descritos en el contrato principal.",
      "La duración coincide con la vigencia del contrato de servicio. Las obligaciones de confidencialidad y seguridad subsisten mientras el Encargado conserve datos.",
    ],
  },
  {
    title: "3. Instrucciones del Responsable",
    bullets: [
      "Usar los datos solo para prestar el servicio contratado.",
      "No utilizarlos para fines propios, publicidad propia ni cesión a terceros.",
      "No vender, alquilar ni ceder datos personales.",
      "Aplicar las medidas de seguridad descritas en este DPA.",
      "Informar al Responsable si una instrucción infringe la normativa aplicable.",
    ],
    note: "El Cliente es responsable de contar con la base legal y las autorizaciones necesarias para comunicarse con los titulares y para encargar el tratamiento.",
  },
  {
    title: "4. Categorías de datos y titulares",
    bullets: [
      "Datos identificativos y de contacto: nombre, documento, teléfono, correo, empresa.",
      "Datos de comunicación: mensajes, adjuntos y metadatos de los canales conectados.",
      "Datos financieros de cobranza: folio, cuotas, fechas, montos, mora y pagos.",
      "Titulares: clientes, prospectos, deudores y usuarios del Cliente.",
    ],
    note: "El Cliente se compromete a no cargar datos sensibles (salud, biometría, origen étnico, opiniones políticas, creencias) salvo que cuente con base legal reforzada y lo informe por escrito.",
  },
  {
    title: "5. Confidencialidad",
    paragraphs: [
      "El Encargado garantiza que las personas autorizadas para tratar los datos están sujetas a deberes de confidencialidad y han recibido formación sobre protección de datos. El deber se mantiene incluso después de finalizar la relación.",
    ],
  },
  {
    title: "6. Medidas de seguridad",
    bullets: [
      "Cifrado en tránsito mediante TLS y cifrado de tokens en reposo (AES-256-GCM).",
      "Aislamiento por organización mediante políticas de seguridad a nivel de fila.",
      "Control de acceso por roles y mínimo privilegio.",
      "Registro de eventos y auditoría de acciones administrativas.",
      "Copias de seguridad gestionadas y procedimiento de restauración.",
      "Gestión de incidentes con notificación al Responsable.",
    ],
  },
  {
    title: "7. Subencargados",
    paragraphs: [
      "El Responsable autoriza el uso de los subencargados necesarios para prestar el servicio. La lista vigente se publica en la Política de Privacidad e incluye, entre otros, proveedores de base de datos, alojamiento, mensajería y modelos de lenguaje.",
      "El Encargado impone a cada subencargado obligaciones equivalentes a las de este DPA y responde por su cumplimiento. Notificará cambios relevantes con antelación razonable para permitir objeciones motivadas.",
    ],
  },
  {
    title: "8. Transferencias internacionales",
    paragraphs: [
      "Cuando un subencargado trate datos fuera de Venezuela, el Encargado aplicará garantías contractuales y técnicas razonables para proteger la información, conforme a la normativa aplicable.",
    ],
  },
  {
    title: "9. Derechos de los titulares",
    paragraphs: [
      "El Encargado asistirá al Responsable para atender solicitudes de acceso, rectificación, actualización, eliminación, portabilidad u oposición, en la medida técnica razonable y dentro de los plazos legales.",
      "Si un titular se dirige directamente al Encargado, la solicitud se canalizará al Responsable sin demora.",
    ],
  },
  {
    title: "10. Asistencia y evaluaciones de impacto",
    paragraphs: [
      "El Encargado colaborará con el Responsable en evaluaciones de impacto y consultas previas a la autoridad, cuando la naturaleza del tratamiento lo exija, siempre que la información esté disponible y no comprometa la seguridad de otros clientes.",
    ],
  },
  {
    title: "11. Notificación de incidentes",
    paragraphs: [
      "El Encargado notificará al Responsable sin demora indebida, y en un plazo máximo de setenta y dos (72) horas desde que tenga conocimiento, cualquier incidente de seguridad que afecte datos personales.",
      "La notificación incluirá la naturaleza del incidente, las categorías y el volumen aproximado de datos afectados, las medidas adoptadas y el punto de contacto.",
    ],
  },
  {
    title: "12. Auditoría",
    paragraphs: [
      "El Responsable podrá solicitar información razonable sobre las medidas de seguridad y, con preaviso de treinta (30) días y sin afectar la confidencialidad de otros clientes, una auditoría documental. Las auditorías presenciales se acordarán por separado.",
    ],
  },
  {
    title: "13. Devolución y eliminación",
    paragraphs: [
      "Al terminar el contrato, el Encargado pondrá a disposición del Responsable una exportación de los datos y, transcurrido el plazo de conservación indicado en la Política de Privacidad, los eliminará o anonimizará salvo obligación legal de conservarlos.",
      "El Responsable puede solicitar la eliminación anticipada siguiendo el procedimiento de la página de Eliminación de datos.",
    ],
  },
  {
    title: "14. Responsabilidad",
    paragraphs: [
      "Cada parte responde por el incumplimiento de sus obligaciones en materia de protección de datos. El Encargado responde por los daños que cause su tratamiento contrario a este DPA o a las instrucciones del Responsable, con los límites previstos en los Términos de Servicio.",
    ],
  },
  {
    title: "15. Ley aplicable",
    paragraphs: [
      "Este DPA se rige por las leyes de la República Bolivariana de Venezuela. Las controversias se resolverán conforme a la cláusula de ley aplicable de los Términos de Servicio.",
    ],
  },
  {
    title: "16. Firma y vigencia",
    paragraphs: [
      "Este documento puede firmarse electrónicamente. La versión firmada prevalece sobre la publicada en el sitio en caso de conflicto. Para solicitar una copia firmada, escribe a contacto@nexusbpo.space con el asunto “DPA”.",
    ],
  },
];

export default function DpaPage() {
  return (
    <LegalShell
      title="Acuerdo de tratamiento de datos (DPA)"
      updated="26 de octubre de 2026"
      current="/dpa"
      intro="Modelo de acuerdo de encargo de tratamiento para clientes de Nexus CRM. Puedes descargarlo en PDF y firmarlo con tu equipo legal."
      sections={SECTIONS}
    >
      <div className="mt-8 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 no-print">
        <PrintButton label="Descargar PDF" />
        <p className="text-xs text-muted-foreground">
          Se abrirá el diálogo de impresión: elige “Guardar como PDF”.
        </p>
      </div>
    </LegalShell>
  );
}
