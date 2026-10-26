import type { Metadata } from "next";
import { LegalShell, type LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Términos de Servicio — NEXUS BPO",
  description:
    "Términos de servicio de Nexus CRM: uso aceptable, canales de terceros, datos, inteligencia artificial, responsabilidad y ley aplicable.",
};

const SECTIONS: LegalSection[] = [
  {
    title: "1. Identificación del prestador",
    paragraphs: [
      "Estos Términos de Servicio regulan el acceso y uso de la plataforma Nexus CRM, operada por REPRESENTACIONES J.J.D.C, CA (“NEXUS BPO”, “nosotros”, “nuestro”), con domicilio en CTRA VIEJA DE LOS TEQUES CASA NRO 4 BARRIO MAMERA, CARACAS, DISTRITO CAPITAL, ZONA POSTAL 1000, Venezuela.",
      "El uso de la plataforma implica la aceptación plena de estos términos. Si no estás de acuerdo, no uses el servicio.",
    ],
  },
  {
    title: "2. Objeto del servicio",
    paragraphs: [
      "Nexus CRM es una plataforma de gestión de relaciones y comunicaciones que permite centralizar conversaciones de distintos canales, organizar contactos y oportunidades, automatizar tareas y gestionar cobranzas.",
      "El servicio se presta en la modalidad de software como servicio (SaaS). Podemos actualizar, mejorar o retirar funcionalidades, procurando notificar los cambios que afecten el uso normal.",
    ],
  },
  {
    title: "3. Registro, cuentas y roles",
    bullets: [
      "Debes proporcionar información veraz y mantenerla actualizada.",
      "Eres responsable de la confidencialidad de tus credenciales y de toda actividad realizada con tu cuenta.",
      "El titular de la cuenta (“Dueño”) puede invitar usuarios y asignar roles con distintos permisos. Responde por las acciones de los usuarios que invite.",
      "Debes notificarnos de inmediato cualquier acceso no autorizado o incidente de seguridad.",
    ],
  },
  {
    title: "4. Planes, período de prueba y pagos",
    paragraphs: [
      "Los planes, límites y precios vigentes se informan en la propuesta comercial o en la página de contratación. Salvo pacto distinto, los importes se expresan en dólares estadounidenses (USD) y no incluyen impuestos aplicables.",
      "El período de prueba, cuando se ofrezca, permite evaluar el servicio sin costo. Al finalizar, el acceso a funciones de pago se suspende hasta que se contrate un plan.",
      "La falta de pago faculta a suspender el servicio tras un aviso razonable. No se realizan reembolsos por períodos ya consumidos, salvo obligación legal o pacto escrito.",
    ],
  },
  {
    title: "5. Uso aceptable",
    paragraphs: ["Te comprometes a no utilizar la plataforma para:"],
    bullets: [
      "Enviar spam, mensajes no solicitados, engañosos o masivos sin consentimiento.",
      "Incumplir las políticas de Meta (WhatsApp Business, Messenger, Instagram) o de TikTok.",
      "Tratar datos personales sin base legal, sin información al titular o sin las autorizaciones exigidas por la ley.",
      "Hostigar, amenazar, discriminar o divulgar la situación de deuda de una persona a terceros.",
      "Suplantar identidades, recolectar credenciales o intentar acceder a cuentas ajenas.",
      "Introducir código malicioso, realizar pruebas de carga no autorizadas o eludir límites técnicos.",
      "Usar el servicio para actividades ilegales, incluyendo fraude, lavado de activos o financiamiento del terrorismo.",
    ],
  },
  {
    title: "6. Canales de terceros y marcas",
    paragraphs: [
      "La conexión con WhatsApp, Facebook Messenger, Instagram y TikTok se realiza mediante las APIs oficiales de dichas plataformas y está sujeta a sus propios términos, políticas de uso y procesos de revisión. Nexus CRM no controla esas plataformas y no garantiza que mantengan sus APIs, permisos o condiciones.",
      "Si una plataforma suspende, limita o cambia el acceso de tu cuenta, el canal correspondiente puede dejar de funcionar. Colaboraremos en la medida de lo posible, sin que ello genere responsabilidad por parte de NEXUS BPO.",
      "WhatsApp, Instagram, Facebook, Messenger, TikTok y Meta son marcas de sus respectivos titulares. Nexus CRM no está afiliado, patrocinado ni respaldado por ellos, salvo que se indique expresamente por escrito.",
    ],
  },
  {
    title: "7. Datos del cliente y datos de terceros",
    paragraphs: [
      "Tú eres el responsable de los datos que cargas o generas en la plataforma, incluidos los datos de tus clientes, prospectos y deudores. Nosotros los tratamos como encargados, únicamente para prestarte el servicio y conforme al documento de privacidad.",
      "Declaras contar con la base legal y las autorizaciones necesarias para comunicarte con los titulares de esos datos y para encargarnos su tratamiento.",
      "No utilizamos los datos de tu organización para fines publicitarios propios ni los vendemos. Las obligaciones y el detalle del tratamiento se describen en la Política de Privacidad.",
    ],
  },
  {
    title: "8. Inteligencia artificial y automatizaciones",
    paragraphs: [
      "La plataforma incluye funciones de IA que generan respuestas y clasifican información. Estas respuestas son sugerencias automatizadas y pueden contener errores.",
      "Eres responsable de configurar y supervisar los agentes de IA, revisar las respuestas sensibles y definir los casos en que se requiere intervención humana.",
      "No uses la IA para emitir decisiones que produzcan efectos legales sobre una persona sin revisión humana, ni para generar contenido engañoso o ilícito.",
    ],
  },
  {
    title: "9. Cobranza y comunicaciones",
    bullets: [
      "Las gestiones deben identificar a la organización acreedora y realizarse en horarios razonables.",
      "No se permite acosar, amenazar, publicar listas de morosos ni revelar la deuda a terceros.",
      "Debes respetar las solicitudes de no contacto y los canales habilitados por el titular.",
      "La plataforma es una herramienta de gestión: no sustituye el cumplimiento de las normas de protección de datos, consumo o cobranza aplicables.",
    ],
  },
  {
    title: "10. Propiedad intelectual",
    paragraphs: [
      "La plataforma, su código, diseño, marcas y documentación son propiedad de NEXUS BPO o de sus licenciantes. Se te concede una licencia limitada, no exclusiva, intransferible y revocable para usar el servicio mientras tu suscripción esté activa.",
      "Conservas la titularidad de tus datos y contenidos. Nos autorizas a alojarlos y procesarlos para prestarte el servicio.",
      "No puedes copiar, descompilar, revender, sublicenciar ni crear obras derivadas de la plataforma sin autorización escrita.",
    ],
  },
  {
    title: "11. Confidencialidad",
    paragraphs: [
      "Cada parte se obliga a proteger la información confidencial de la otra y a usarla solo para ejecutar este acuerdo. La obligación se mantiene durante la relación y por dos años después de su término, salvo para datos personales, que se rigen por la política de privacidad.",
    ],
  },
  {
    title: "12. Disponibilidad y soporte",
    paragraphs: [
      "Procuramos una disponibilidad alta y realizamos mantenimientos programados. No garantizamos un servicio ininterrumpido ni libre de errores; la información de estado se publica en la página de Estado del sistema.",
      "El soporte se presta por los canales habilitados y en horarios laborables, salvo que la propuesta comercial indique otra cosa.",
    ],
  },
  {
    title: "13. Suspensión y terminación",
    paragraphs: [
      "Podemos suspender o cancelar el acceso si se incumplen estos términos, si existe riesgo para la seguridad o si una autoridad lo requiere. Cuando sea posible, avisaremos antes.",
      "Puedes cancelar el servicio en cualquier momento desde la configuración de tu cuenta o escribiéndonos. Al terminar, tus datos se conservan por el plazo indicado en la Política de Privacidad y luego se eliminan o anonimizan.",
    ],
  },
  {
    title: "14. Garantías y limitación de responsabilidad",
    paragraphs: [
      "El servicio se presta “tal cual” y “según disponibilidad”. En la medida permitida por la ley, no otorgamos garantías implícitas de comerciabilidad, idoneidad para un fin particular o no infracción.",
      "No respondemos por daños indirectos, incidentales, especiales, lucro cesante, pérdida de oportunidades o pérdida de datos derivados del uso o la imposibilidad de uso del servicio.",
      "Nuestra responsabilidad total acumulada se limita al monto efectivamente pagado por el servicio en los tres (3) meses anteriores al hecho que la origine.",
      "Nada en estos términos limita responsabilidades que no puedan limitarse por ley, como el dolo o la culpa grave.",
    ],
  },
  {
    title: "15. Indemnidad",
    paragraphs: [
      "Te obligas a mantener indemne a NEXUS BPO frente a reclamaciones de terceros derivadas de: (i) los datos o contenidos que cargas; (ii) el uso que hagas de los canales de terceros; (iii) el incumplimiento de las normas de protección de datos o de comunicaciones; o (iv) el uso indebido de la plataforma por parte de tus usuarios.",
    ],
  },
  {
    title: "16. Modificaciones",
    paragraphs: [
      "Podemos actualizar estos términos para reflejar cambios legales o del servicio. Publicaremos la versión vigente con su fecha de actualización y, si el cambio es sustancial, avisaremos por correo o dentro de la plataforma.",
      "El uso continuado después de la entrada en vigor implica aceptación de la nueva versión.",
    ],
  },
  {
    title: "17. Ley aplicable y resolución de conflictos",
    paragraphs: [
      "Estos términos se rigen por las leyes de la República Bolivariana de Venezuela.",
      "Las partes intentarán resolver de buena fe cualquier controversia mediante negociación directa durante treinta (30) días. Si no se resuelve, se someterá a los tribunales competentes de Caracas, sin perjuicio de las normas de protección al consumidor que resulten aplicables.",
    ],
  },
  {
    title: "18. Contacto",
    bullets: [
      "Correo: contacto@nexusbpo.space",
      "Teléfono: 0422 2433946",
      "Dirección: CTRA VIEJA DE LOS TEQUES CASA NRO 4 BARRIO MAMERA, CARACAS, DISTRITO CAPITAL, ZONA POSTAL 1000.",
    ],
  },
];

export default function TerminosPage() {
  return (
    <LegalShell
      title="Términos de Servicio"
      updated="26 de octubre de 2026"
      current="/terminos"
      intro="Estos términos regulan el uso de Nexus CRM por parte de empresas y profesionales. Léelos junto con la Política de Privacidad y la página de Cumplimiento de plataformas."
      sections={SECTIONS}
    />
  );
}
