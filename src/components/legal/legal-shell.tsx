import Link from "next/link";

export interface LegalSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  /** Aviso destacado dentro de la sección. */
  note?: string;
}

const LEGAL_LINKS = [
  { href: "/politicas", label: "Políticas" },
  { href: "/terminos", label: "Términos" },
  { href: "/privacidad", label: "Privacidad" },
  { href: "/cumplimiento", label: "Cumplimiento" },
  { href: "/seguridad", label: "Seguridad" },
  { href: "/eliminacion-de-datos", label: "Eliminación de datos" },
  { href: "/dpa", label: "DPA" },
  { href: "/estado-del-sistema", label: "Estado" },
];

export function LegalNav({ current }: { current?: string }) {
  return (
    <nav
      aria-label="Documentos legales"
      className="mb-10 flex flex-wrap gap-2 border-b border-border pb-5 no-print"
    >
      {LEGAL_LINKS.map((link) => {
        const active = link.href === current;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              active
                ? "rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                : "rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Envoltorio común de los documentos legales: navegación entre
 * documentos, encabezado, secciones y datos de contacto.
 */
export function LegalShell({
  title,
  updated,
  intro,
  sections,
  current,
  children,
}: {
  title: string;
  updated: string;
  intro?: string;
  sections: LegalSection[];
  current?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <LegalNav current={current} />

        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Última actualización: {updated}
          </p>
          {intro ? (
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              {intro}
            </p>
          ) : null}
        </header>

        <div className="space-y-9">
          {sections.map((section) => (
            <section key={section.title} id={slugify(section.title)}>
              <h2 className="text-lg font-semibold text-foreground">
                {section.title}
              </h2>

              {section.paragraphs?.map((paragraph, index) => (
                <p
                  key={index}
                  className="mt-3 text-sm leading-relaxed text-muted-foreground"
                >
                  {paragraph}
                </p>
              ))}

              {section.bullets && section.bullets.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}

              {section.note ? (
                <p className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {section.note}
                </p>
              ) : null}
            </section>
          ))}
        </div>

        {children}

        <footer className="mt-14 border-t border-border pt-6 text-xs text-muted-foreground no-print">
          <p>
            <strong className="text-foreground">
              REPRESENTACIONES J.J.D.C, CA
            </strong>{" "}
            — NEXUS BPO / Nexus CRM
          </p>
          <p className="mt-1">
            CTRA VIEJA DE LOS TEQUES CASA NRO 4 BARRIO MAMERA, CARACAS,
            DISTRITO CAPITAL, ZONA POSTAL 1000, Venezuela.
          </p>
          <p className="mt-1">
            Contacto:{" "}
            <a
              className="text-primary underline"
              href="mailto:contacto@nexusbpo.space"
            >
              contacto@nexusbpo.space
            </a>{" "}
            · Teléfono: 0422 2433946
          </p>
          <p className="mt-4">
            Este documento forma parte del conjunto de políticas de Nexus CRM.
            Consulta también{" "}
            <Link className="text-primary underline" href="/privacidad">
              Privacidad
            </Link>
            ,{" "}
            <Link className="text-primary underline" href="/cumplimiento">
              Cumplimiento de plataformas
            </Link>{" "}
            y{" "}
            <Link className="text-primary underline" href="/seguridad">
              Seguridad
            </Link>
            .
          </p>
        </footer>
      </div>
    </main>
  );
}
