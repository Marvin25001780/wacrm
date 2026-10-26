import type { Metadata } from "next";
import Link from "next/link";
import { LegalNav } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Políticas y legal — NEXUS BPO",
  description:
    "Índice de las políticas de Nexus CRM: términos, privacidad, cumplimiento de plataformas, seguridad y eliminación de datos.",
};

const DOCS = [
  {
    href: "/terminos",
    title: "Términos de Servicio",
    description:
      "Reglas de uso, planes y pagos, canales de terceros, propiedad intelectual, responsabilidad e indemnidad.",
  },
  {
    href: "/privacidad",
    title: "Política de Privacidad",
    description:
      "Qué datos tratamos, con qué finalidad, subencargados, transferencias, conservación y derechos.",
  },
  {
    href: "/cumplimiento",
    title: "Cumplimiento de plataformas",
    description:
      "Reglas para operar con las APIs de Meta (WhatsApp, Messenger, Instagram) y TikTok.",
  },
  {
    href: "/seguridad",
    title: "Seguridad",
    description:
      "Cifrado, control de acceso, auditoría, copias de seguridad y respuesta a incidentes.",
  },
  {
    href: "/dpa",
    title: "Acuerdo de tratamiento de datos (DPA)",
    description:
      "Modelo de encargo de tratamiento para clientes corporativos, descargable en PDF.",
  },
  {
    href: "/eliminacion-de-datos",
    title: "Eliminación de datos",
    description:
      "Cómo revocar el acceso y solicitar la eliminación de datos, incluidos los de Meta y TikTok.",
  },
  {
    href: "/estado-del-sistema",
    title: "Estado del sistema",
    description:
      "Estado de los servicios, mantenimientos programados y cómo reportar una incidencia.",
  },
];

export default function PoliticasPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-14">
        <LegalNav current="/politicas" />

        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Políticas y legal
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Documentos que rigen el uso de Nexus CRM y el tratamiento de datos.
            Si necesitas una versión firmada, un acuerdo de tratamiento de datos
            o información adicional para tu proceso de compras, escríbenos a{" "}
            <a
              className="text-primary underline"
              href="mailto:contacto@nexusbpo.space"
            >
              contacto@nexusbpo.space
            </a>
            .
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {DOCS.map((doc) => (
            <Link
              key={doc.href}
              href={doc.href}
              className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
            >
              <h2 className="text-base font-semibold text-foreground group-hover:text-primary">
                {doc.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {doc.description}
              </p>
            </Link>
          ))}
        </div>

        <section className="mt-12 rounded-xl border border-border bg-card p-6">
          <h2 className="text-base font-semibold text-foreground">
            Compromisos de tratamiento
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>No vendemos datos personales ni los usamos para publicidad propia.</li>
            <li>
              Solo accedemos a los canales que el cliente autoriza, mediante APIs
              oficiales.
            </li>
            <li>
              Aislamiento por organización y permisos por rol en la base de datos.
            </li>
            <li>
              Tokens de canales cifrados y eliminados al desconectar la cuenta.
            </li>
            <li>
              Eliminación de datos a solicitud, con plazos definidos y
              comprobables.
            </li>
          </ul>
        </section>

        <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          <p>
            <strong className="text-foreground">
              REPRESENTACIONES J.J.D.C, CA
            </strong>{" "}
            — Nexus CRM · Caracas, Venezuela · contacto@nexusbpo.space
          </p>
        </footer>
      </div>
    </main>
  );
}
