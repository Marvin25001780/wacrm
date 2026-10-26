import type { Metadata } from "next";
import { LegalShell, type LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Seguridad — NEXUS BPO",
  description:
    "Cómo Nexus CRM protege los datos: cifrado, aislamiento por organización, roles, auditoría, copias de seguridad y respuesta a incidentes.",
};

const SECTIONS: LegalSection[] = [
  {
    title: "1. Arquitectura",
    paragraphs: [
      "Nexus CRM es una aplicación web alojada en infraestructura en la nube. La base de datos, la autenticación y el almacenamiento de archivos se gestionan con Supabase; la aplicación se sirve mediante Vercel.",
      "Cada organización (negocio) tiene su propio espacio lógico. El acceso a los datos se resuelve en la base de datos mediante políticas de seguridad a nivel de fila (RLS), no solo en la interfaz.",
    ],
  },
  {
    title: "2. Cifrado",
    bullets: [
      "Todo el tráfico entre el navegador y la plataforma viaja por HTTPS/TLS.",
      "Los tokens de acceso a canales (WhatsApp, Meta, TikTok) se guardan cifrados con AES-256-GCM y nunca se devuelven al navegador.",
      "Las credenciales de los proveedores se almacenan como secretos en el entorno del servidor.",
      "Las contraseñas se gestionan mediante el proveedor de identidad y no se almacenan en texto plano.",
    ],
  },
  {
    title: "3. Control de acceso",
    bullets: [
      "Roles por organización: Dueño, Administrador, Agente y Visor.",
      "Módulos habilitables por negocio, de modo que un cliente solo ve las secciones contratadas.",
      "Verificación de permisos en el servidor para las operaciones sensibles, no solo en la interfaz.",
      "Sesiones con cookies seguras y expiración; cierre de sesión remoto al cambiar credenciales.",
    ],
  },
  {
    title: "4. Registros y auditoría",
    paragraphs: [
      "Registramos eventos relevantes: inicios de sesión, cambios de configuración, importaciones, envíos masivos y acciones administrativas. Los registros se conservan para diagnóstico y respuesta a incidentes.",
    ],
  },
  {
    title: "5. Copias de seguridad",
    paragraphs: [
      "La base de datos cuenta con copias automáticas gestionadas por el proveedor de infraestructura. Adicionalmente, el cliente puede exportar su información desde la plataforma.",
      "Las copias se prueban periódicamente. Los tiempos de restauración dependen del proveedor y del volumen de datos.",
    ],
  },
  {
    title: "6. Respuesta a incidentes",
    bullets: [
      "Clasificamos los incidentes por impacto y activamos un responsable de respuesta.",
      "Contenemos el incidente, preservamos evidencia y corregimos la causa.",
      "Notificamos a los clientes afectados y a las autoridades cuando corresponda.",
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
    title: "8. Divulgación responsable",
    paragraphs: [
      "Si encuentras una vulnerabilidad, escríbenos a contacto@nexusbpo.space con el asunto “Seguridad”. Pedimos que no divulgues el hallazgo públicamente antes de que podamos corregirlo y que no accedas a datos de terceros durante la prueba.",
      "Nos comprometemos a revisar el reporte, confirmar la recepción y mantenerte informado del avance.",
    ],
  },
  {
    title: "9. Contacto",
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
      intro="Resumen de las medidas técnicas y organizativas que aplicamos para proteger la información de tu organización y de tus clientes."
      sections={SECTIONS}
    />
  );
}
