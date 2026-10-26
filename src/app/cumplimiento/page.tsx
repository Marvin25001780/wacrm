import type { Metadata } from "next";
import { LegalShell, type LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Cumplimiento de plataformas — NEXUS BPO",
  description:
    "Cómo Nexus CRM cumple los términos de Meta (WhatsApp, Messenger, Instagram) y TikTok: uso de datos, permisos, mensajería y eliminación.",
};

const SECTIONS: LegalSection[] = [
  {
    title: "1. Nuestro compromiso",
    paragraphs: [
      "Nexus CRM se conecta a plataformas de terceros exclusivamente mediante sus APIs oficiales y con el consentimiento del titular de cada cuenta. Esta página resume las reglas que aplicamos para cumplir los términos de Meta y TikTok.",
      "Si detectas un uso que infrinja esas políticas, escríbenos a contacto@nexusbpo.space y actuaremos sobre la cuenta involucrada.",
    ],
  },
  {
    title: "2. Uso de datos de la plataforma Meta",
    bullets: [
      "Solo accedemos a los datos cubiertos por los permisos que el usuario aprueba al conectar su cuenta.",
      "No vendemos, alquilamos ni cedemos datos de la plataforma a terceros con fines publicitarios.",
      "No usamos los datos para crear perfiles de usuarios ajenos a la relación con el cliente que los autorizó.",
      "No realizamos scraping ni extracción masiva fuera de las APIs oficiales.",
      "No almacenamos contraseñas de cuentas de Meta ni de TikTok.",
      "Los tokens se guardan cifrados y se eliminan al desconectar el canal.",
    ],
  },
  {
    title: "3. Mensajería de WhatsApp Business",
    bullets: [
      "El cliente debe contar con un número habilitado en WhatsApp Business Platform y aceptar sus condiciones.",
      "Las conversaciones iniciadas por la empresa requieren plantillas aprobadas por Meta y una base legal de contacto.",
      "Respetamos la ventana de servicio de 24 horas: fuera de ella solo enviamos plantillas aprobadas.",
      "Aplicamos límites de envío, control de calidad y registro de errores devueltos por Meta.",
      "No enviamos spam ni mensajes a contactos que no hayan otorgado su consentimiento.",
    ],
  },
  {
    title: "4. Messenger e Instagram",
    bullets: [
      "La conexión se realiza con Facebook Login o con el inicio de sesión de Instagram, según el flujo elegido.",
      "Solicitamos solo los permisos necesarios para leer y responder mensajes y mostrar la identidad de la cuenta conectada.",
      "No accedemos a publicaciones, comentarios, seguidores ni datos de terceros fuera de los permisos aprobados.",
      "Las respuestas automáticas se identifican como tales cuando la plataforma lo exige.",
      "El usuario puede revocar el acceso desde la configuración de Meta en cualquier momento.",
    ],
  },
  {
    title: "5. TikTok",
    bullets: [
      "Usamos Login Kit para identificar la cuenta de empresa que autoriza la conexión.",
      "Los permisos de mensajería se solicitan solo cuando la app cuenta con la aprobación correspondiente.",
      "No publicamos contenido, no modificamos videos y no accedemos a métricas privadas sin permiso expreso.",
      "El token se almacena cifrado y el usuario puede desconectar la cuenta desde el CRM.",
    ],
  },
  {
    title: "6. Revisión de aplicaciones y transparencia",
    paragraphs: [
      "Las integraciones se someten a los procesos de revisión de Meta y TikTok. Mantenemos la información de la app actualizada: nombre, ícono, descripción, política de privacidad, condiciones del servicio y mecanismo de eliminación de datos.",
      "Podemos solicitar permisos adicionales solo cuando una función los necesita y podemos demostrarlo en la revisión.",
    ],
  },
  {
    title: "7. Eliminación de datos y revocación",
    paragraphs: [
      "Cualquier persona puede solicitar la eliminación de sus datos siguiendo las instrucciones de la página de Eliminación de datos. También puede revocar el acceso desde la configuración de Meta o TikTok.",
      "Al revocar el acceso dejamos de recibir nuevos datos de esa cuenta. El historial se elimina a solicitud del cliente o al terminar la relación, según los plazos de la Política de Privacidad.",
    ],
  },
  {
    title: "8. Seguridad y control de acceso",
    bullets: [
      "Aislamiento de datos por organización mediante políticas a nivel de fila.",
      "Roles y permisos para limitar quién ve cada módulo.",
      "Cifrado en tránsito y de credenciales en reposo.",
      "Registro de auditoría de acciones sensibles.",
      "Revisión de dependencias y monitoreo de errores.",
    ],
  },
  {
    title: "9. Contenido y uso prohibido",
    paragraphs: [
      "No permitimos el uso de la plataforma para acosar, enviar spam, suplantar identidades, difundir contenido ilegal, manipular elecciones o vulnerar derechos de terceros. Las cuentas que incurran en estas conductas pueden ser suspendidas.",
    ],
  },
  {
    title: "10. Cooperación con las plataformas",
    paragraphs: [
      "Atenderemos requerimientos razonables de Meta o TikTok relacionados con el uso de sus APIs, incluidos reportes de abuso, y colaboraremos en investigaciones cuando exista una obligación legal.",
    ],
  },
  {
    title: "11. Contacto",
    bullets: [
      "Correo: contacto@nexusbpo.space",
      "Asunto sugerido: “Cumplimiento de plataformas”.",
      "Respondemos en un plazo máximo de cinco (5) días hábiles.",
    ],
  },
];

export default function CumplimientoPage() {
  return (
    <LegalShell
      title="Cumplimiento de plataformas"
      updated="26 de octubre de 2026"
      current="/cumplimiento"
      intro="Reglas que aplicamos para cumplir los términos de Meta (WhatsApp Business, Messenger e Instagram) y de TikTok, y para proteger los datos de las cuentas conectadas."
      sections={SECTIONS}
    />
  );
}
