import type { Metadata } from "next";
import { LegalShell, type LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Política de Privacidad — NEXUS BPO",
  description:
    "Cómo Nexus CRM recopila, usa, protege y elimina datos personales, incluidos los provenientes de WhatsApp, Instagram, Facebook Messenger y TikTok.",
};

const SECTIONS: LegalSection[] = [
  {
    title: "1. Responsable y alcance",
    paragraphs: [
      "REPRESENTACIONES J.J.D.C, CA (“NEXUS BPO”, “nosotros”) opera la plataforma Nexus CRM y es responsable del tratamiento de los datos de las cuentas, la facturación y el uso del sitio.",
      "Respecto de los datos que nuestros clientes cargan o generan en la plataforma (contactos, conversaciones, cartera, pagos), actuamos como encargados del tratamiento: el cliente es el responsable y decide el propósito.",
      "Esta política aplica al sitio nexusbpo.space, a la aplicación Nexus CRM y a las integraciones con plataformas de terceros.",
    ],
  },
  {
    title: "2. Datos que recopilamos",
    bullets: [
      "Datos de cuenta: nombre, correo electrónico, teléfono, organización, rol y preferencias.",
      "Datos de facturación: plan, estado de pago y datos fiscales. No almacenamos números completos de tarjeta.",
      "Datos operativos que cargas: contactos, empresas, leads, oportunidades, notas, adjuntos y registros de cobranza (documento, folio, cuotas, fechas, montos y mora).",
      "Conversaciones: mensajes, adjuntos, reacciones y metadatos de los canales conectados.",
      "Datos técnicos: dirección IP, tipo de dispositivo, navegador, registros de acceso y eventos de seguridad.",
      "Datos de uso: funciones utilizadas, errores y métricas agregadas para mejorar el servicio.",
    ],
  },
  {
    title: "3. Datos recibidos de Meta y TikTok",
    paragraphs: [
      "Cuando conectas una cuenta de WhatsApp Business, una Página de Facebook, una cuenta profesional de Instagram o una cuenta de empresa de TikTok, autorizas a Nexus CRM a recibir los datos que la plataforma entrega mediante sus APIs oficiales, en el marco de los permisos que apruebas.",
    ],
    bullets: [
      "WhatsApp Cloud API: número de teléfono, nombre de perfil y mensajes intercambiados con tu cuenta empresarial.",
      "Facebook Messenger e Instagram: identificador de la persona que escribe, nombre público disponible, contenido de los mensajes y metadatos del evento.",
      "Instagram con inicio de sesión de Instagram: identidad de la cuenta conectada y mensajes directos recibidos.",
      "TikTok: identidad de la cuenta autorizada (nombre, usuario, avatar) y, cuando el permiso está aprobado, mensajes directos.",
    ],
    note: "No realizamos scraping, no accedemos a datos fuera de los permisos concedidos y no solicitamos contraseñas de tus cuentas sociales.",
  },
  {
    title: "4. Para qué usamos los datos",
    bullets: [
      "Prestar el servicio: mostrar conversaciones, organizar contactos y gestionar cobranzas.",
      "Enviar y recibir mensajes por los canales que conectas, en tu nombre.",
      "Autenticar usuarios, aplicar permisos y proteger la seguridad de la cuenta.",
      "Generar métricas y reportes para tu organización.",
      "Prestar soporte y diagnosticar errores.",
      "Cumplir obligaciones legales, contables y requerimientos de autoridades competentes.",
      "Mejorar el producto con información agregada o anonimizada.",
    ],
  },
  {
    title: "5. Bases legales",
    paragraphs: [
      "Tratamos datos según la base legal aplicable a cada caso: ejecución del contrato contigo, cumplimiento de obligaciones legales, interés legítimo en la seguridad y mejora del servicio, y consentimiento cuando corresponda.",
      "Para los datos de tus clientes y deudores, la base legal la determina tu organización como responsable. Nosotros tratamos esos datos siguiendo tus instrucciones.",
    ],
  },
  {
    title: "6. Datos de cobranza",
    paragraphs: [
      "Cuando usas el módulo de cobranza, la organización acreedora es la responsable de los datos de sus deudores y Nexus CRM los trata por su cuenta para gestionar la recuperación de obligaciones.",
    ],
    bullets: [
      "Finalidad: recordatorios, acuerdos de pago, registro de pagos y reportes de cartera.",
      "Uso restringido: no los usamos para fines propios, no los vendemos y no los compartimos fuera de los proveedores descritos en esta política.",
      "Contacto: las gestiones deben identificar al acreedor, realizarse en horarios razonables y respetar las solicitudes de no contacto.",
      "Conservación: durante la relación con el acreedor y el plazo legal aplicable; luego se eliminan o anonimizan.",
      "Derechos: las solicitudes de acceso, rectificación o eliminación se dirigen al acreedor. Si nos escriben, orientamos y canalizamos la solicitud.",
    ],
  },
  {
    title: "7. Inteligencia artificial",
    paragraphs: [
      "Algunas funciones envían el contenido de la conversación a modelos de lenguaje para generar respuestas o clasificar información. Lo hacemos para prestarte el servicio y bajo instrucciones de tu organización.",
      "Puedes desactivar los agentes de IA. Las respuestas automáticas son sugerencias y requieren supervisión humana en casos sensibles.",
      "No utilizamos tus conversaciones para entrenar modelos propios ni de terceros con fines comerciales.",
    ],
  },
  {
    title: "8. Cookies y tecnologías similares",
    paragraphs: [
      "Usamos cookies y almacenamiento local estrictamente necesarios para mantener la sesión, recordar preferencias de tema y proteger la autenticación. No usamos cookies publicitarias de terceros en la aplicación.",
      "Puedes bloquear las cookies desde tu navegador, pero algunas funciones, como el inicio de sesión, dejarán de funcionar.",
    ],
  },
  {
    title: "9. Proveedores y subencargados",
    paragraphs: [
      "Trabajamos con proveedores que tratan datos por nuestra cuenta y bajo obligaciones de confidencialidad y seguridad:",
    ],
    bullets: [
      "Supabase: base de datos, autenticación y almacenamiento.",
      "Vercel: alojamiento y entrega de la aplicación.",
      "Meta Platforms: WhatsApp Business Platform, Messenger, Instagram y sus APIs.",
      "TikTok: Login Kit y APIs de mensajería, cuando el canal está habilitado.",
      "Proveedores de modelos de IA: procesamiento de lenguaje para respuestas automatizadas.",
      "Servicios de correo transaccional y monitoreo de errores.",
    ],
    note: "La lista puede actualizarse. Publicaremos los cambios relevantes en esta página.",
  },
  {
    title: "10. Transferencias internacionales",
    paragraphs: [
      "Nuestros proveedores pueden almacenar o procesar datos fuera de Venezuela. En esos casos aplicamos medidas contractuales y técnicas razonables para proteger la información, conforme a la normativa aplicable.",
    ],
  },
  {
    title: "11. Conservación",
    paragraphs: [
      "Conservamos los datos mientras tu cuenta esté activa y durante el tiempo necesario para cumplir obligaciones legales, resolver disputas y prevenir fraude.",
      "Cuando termina la relación, eliminamos o anonimizamos los datos personales en un plazo máximo de noventa (90) días, salvo aquellos que debamos conservar por ley.",
    ],
  },
  {
    title: "12. Seguridad",
    paragraphs: [
      "Aplicamos medidas técnicas y organizativas: cifrado en tránsito, cifrado de credenciales y tokens, aislamiento por organización mediante políticas de seguridad a nivel de fila, control de acceso por roles y registros de auditoría.",
      "Ningún sistema es completamente infalible. Si ocurre un incidente que afecte datos personales, lo notificaremos a los clientes afectados y a las autoridades cuando corresponda.",
    ],
  },
  {
    title: "13. Tus derechos",
    paragraphs: [
      "Puedes solicitar acceso, rectificación, actualización, portabilidad o eliminación de tus datos, y oponerte a determinados tratamientos.",
      "Escríbenos a contacto@nexusbpo.space indicando tu nombre, la organización a la que perteneces y el derecho que deseas ejercer. Responderemos en un plazo razonable y, como máximo, treinta (30) días.",
      "Si los datos pertenecen a un cliente de Nexus CRM, canalizaremos la solicitud a esa organización, que es la responsable.",
    ],
  },
  {
    title: "14. Menores de edad",
    paragraphs: [
      "El servicio está dirigido a empresas y profesionales. No recopilamos deliberadamente datos de menores de edad. Si detectamos una cuenta de un menor, la suspenderemos y eliminaremos los datos correspondientes.",
    ],
  },
  {
    title: "15. Decisiones automatizadas",
    paragraphs: [
      "La plataforma puede priorizar contactos o sugerir acciones con base en reglas y modelos. No tomamos decisiones que produzcan efectos legales sobre una persona sin intervención humana de la organización cliente.",
    ],
  },
  {
    title: "16. Cambios a esta política",
    paragraphs: [
      "Podemos actualizar esta política para reflejar cambios legales o del servicio. Publicaremos la versión vigente con su fecha y, si el cambio es sustancial, avisaremos por correo o dentro de la plataforma.",
    ],
  },
  {
    title: "17. Contacto y reclamos",
    bullets: [
      "Correo: contacto@nexusbpo.space",
      "Teléfono: 0422 2433946",
      "Dirección: CTRA VIEJA DE LOS TEQUES CASA NRO 4 BARRIO MAMERA, CARACAS, DISTRITO CAPITAL, ZONA POSTAL 1000.",
    ],
  },
];

export default function PrivacidadPage() {
  return (
    <LegalShell
      title="Política de Privacidad"
      updated="26 de octubre de 2026"
      current="/privacidad"
      intro="Esta política explica qué datos tratamos, con qué finalidad, con quién los compartimos y cómo puedes ejercer tus derechos. Incluye el tratamiento de datos provenientes de WhatsApp, Instagram, Facebook Messenger y TikTok."
      sections={SECTIONS}
    />
  );
}
