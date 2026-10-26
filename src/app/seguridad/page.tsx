import type { Metadata } from "next";
import { LegalShell, type LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Seguridad — NEXUS BPO",
  description:
    "Medidas de seguridad implementadas en Nexus CRM: cifrado, aislamiento por organización, roles, auditoría y respuesta a incidentes.",
};

const SECTIONS: LegalSection[] = [
  {
    title: "1. Arquitectura",
    paragraphs: [
      "Nexus CRM es una aplicación web alojada en infraestructura en la nube. La base de datos, la autenticación y el almacenamiento de archivos se gestionan con Supabase; la aplicación se sirve mediante Vercel.",
      "Cada organización (negocio) tiene su propio espacio lógico. El acceso a los datos se resuelve en la base de datos con políticas de seguridad a nivel de fila (RLS), no solo en la interfaz.",
    ],
    note: "Todas las tablas de la aplicación tienen RLS habilitado. Una consulta sin la política adecuada devuelve cero filas, aunque la petición llegue directamente a la API.",
  },
  {
    title: "2. Cifrado y transporte",
    bullets: [
      "Todo el tráfico entre el navegador y la plataforma viaja por HTTPS/TLS, con HSTS y redirección a HTTPS.",
      "Los tokens de acceso a canales (WhatsApp, Meta, TikTok) se guardan cifrados con AES-256-GCM, que incluye autenticación: un token alterado falla al descifrar en lugar de devolver datos corruptos.",
      "Las credenciales y secretos de proveedores viven en variables de entorno del servidor, nunca en el navegador.",
      "Las contraseñas las gestiona el proveedor de identidad; la aplicación no las almacena en texto plano.",
      "Los formularios públicos y las cookies de OAuth usan cookies HttpOnly y SameSite, y las de sesión viajan con Secure.",
    ],
  },
  {
    title: "3. Control de acceso",
    bullets: [
      "Cuatro roles por organización: Dueño, Administrador, Agente y Visor.",
      "Módulos habilitables por negocio: un cliente solo ve las secciones contratadas, y las rutas deshabilitadas redirigen.",
      "Verificación de permisos en el servidor en las rutas de API sensibles (requireRole), además de la RLS de la base de datos.",
      "Invitaciones con token de un solo uso y caducidad.",
      "Cierre de todas las sesiones desde Configuración cuando se sospecha un acceso indebido.",
    ],
  },
  {
    title: "4. Registros y auditoría",
    paragraphs: [
      "Las acciones sensibles quedan registradas en `audit_logs` con la cuenta, el usuario, la tabla, la operación, el registro afectado y la diferencia de datos. El registro descarta automáticamente tokens, contraseñas y secretos.",
      "Tablas auditadas: perfiles y roles, invitaciones, configuración de WhatsApp, canales de Meta y TikTok, agentes de IA, bots, segmentos, difusiones y todo el módulo de cobranza (deudores, créditos, cuotas, pagos, lotes de importación y políticas).",
      "Los inicios de sesión los registra el proveedor de identidad y se consultan en su panel de autenticación.",
    ],
    note: "El historial de auditoría es de solo lectura para los clientes y se conserva mientras exista la cuenta.",
  },
  {
    title: "5. Copias de seguridad y exportación",
    paragraphs: [
      "La base de datos cuenta con copias automáticas gestionadas por el proveedor de infraestructura, según el plan contratado. El procedimiento de restauración está documentado y se prueba periódicamente.",
      "Además, cada organización puede exportar en CSV la información de los módulos principales (contactos, métricas y reportes de cobranza) sin depender de nosotros.",
    ],
    note: "No prometemos un punto de recuperación exacto (RPO/RTO) fuera del acuerdo de servicio firmado. Si tu operación lo requiere, lo pactamos por escrito.",
  },
  {
    title: "6. Respuesta a incidentes",
    bullets: [
      "Clasificamos el incidente por impacto y asignamos un responsable.",
      "Contenemos, preservamos evidencia y corregimos la causa.",
      "Notificamos a los clientes afectados en un plazo máximo de 72 horas desde que tenemos conocimiento, y a las autoridades cuando corresponda.",
      "Documentamos el incidente y las medidas preventivas.",
    ],
  },
  {
    title: "7. Buenas prácticas para el cliente",
    bullets: [
      "Usa contraseñas largas y únicas, y activa la verificación en dos pasos cuando esté disponible.",
      "Asigna el rol mínimo necesario a cada usuario.",
      "Revisa periódicamente los usuarios activos y desconecta los canales que no uses.",
      "No compartas tokens ni credenciales por correo o mensajería.",
      "Configura los módulos del negocio según lo que realmente necesita cada equipo.",
    ],
  },
  {
    title: "8. Alcance y limitaciones",
    paragraphs: [
      "Aplicamos las medidas descritas, pero ningún sistema es infalible. No contamos con certificaciones ISO 27001 ni SOC 2; si tu proceso de compras las exige, indícalo y evaluamos el camino.",
      "La seguridad también depende del uso: un usuario con permisos amplios puede exportar o reenviar información. Recomendamos revisar los roles antes de invitar a alguien externo.",
    ],
  },
  {
    title: "9. Divulgación responsable",
    paragraphs: [
      "Si encuentras una vulnerabilidad, escríbenos a contacto@nexusbpo.space con el asunto “Seguridad”. Pedimos que no la divulgues públicamente antes de que podamos corregirla y que no accedas a datos de terceros durante la prueba.",
      "Confirmamos la recepción y te mantenemos informado del avance.",
    ],
  },
  {
    title: "10. Contacto",
    bullets: [
      "Correo: contacto@nexusbpo.space",
      "Teléfono: 0422 2433946",
      "Horario de atención: lunes a viernes, 8:00 a 18:00 (America/Caracas).",
    ],
  },
];

export default function SeguridadPage() {
  return (
    <LegalShell
      title="Seguridad"
      updated="26 de octubre de 2026"
      current="/seguridad"
      intro="Medidas técnicas y organizativas implementadas en la plataforma. Solo describimos controles que están en funcionamiento."
      sections={SECTIONS}
    />
  );
}
