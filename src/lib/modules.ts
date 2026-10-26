// ============================================================
// Catálogo de módulos por negocio (cuenta).
//
// `accounts.enabled_modules` guarda las claves habilitadas. Una lista
// vacía o NULL significa "todos", que es como se comportaban las
// cuentas antes de la migración 080.
//
// Este archivo es la fuente única: lo consumen la navegación, el
// guardia de rutas y el selector de módulos del switcher de negocios.
// ============================================================

export interface ModuleDefinition {
  key: string;
  label: string;
  /** Rutas que pertenecen al módulo. */
  hrefs: string[];
}

export const MODULE_CATALOG: ModuleDefinition[] = [
  {
    key: "dashboard",
    label: "Panel principal",
    hrefs: ["/dashboard"],
  },
  {
    key: "inbox",
    label: "Bandeja de entrada",
    hrefs: ["/inbox"],
  },
  {
    key: "pos",
    label: "POS",
    hrefs: ["/pos"],
  },
  {
    key: "contacts",
    label: "Contactos y empresas",
    hrefs: ["/contacts", "/organizations"],
  },
  {
    key: "leads",
    label: "Leads",
    hrefs: ["/leads"],
  },
  {
    key: "pipelines",
    label: "Pipelines",
    hrefs: ["/pipelines"],
  },
  {
    key: "communications",
    label: "Comunicaciones",
    hrefs: [
      "/channels",
      "/sms",
      "/broadcasts",
      "/chat",
      "/notifications",
    ],
  },
  {
    key: "flows",
    label: "Flujos y automatizaciones",
    hrefs: ["/flows", "/automations"],
  },
  {
    key: "operations",
    label: "Operaciones",
    hrefs: [
      "/calendar",
      "/activities",
      "/spaces",
      "/notes",
      "/attachments",
      "/timeline",
    ],
  },
  {
    key: "analytics",
    label: "Analítica",
    hrefs: ["/metrics", "/productivity", "/segments", "/audit"],
  },
  {
    key: "collections",
    label: "Cobranza",
    hrefs: ["/cobranza", "/receivables"],
  },
];

export const MODULE_KEYS: string[] = MODULE_CATALOG.map((m) => m.key);

/** Todas las claves, en orden de catálogo. */
export function allModuleKeys(): string[] {
  return MODULE_KEYS.slice();
}

/**
 * Descarta claves desconocidas y duplicados. Devuelve un arreglo
 * ordenado según el catálogo para que la UI sea estable.
 */
export function normalizeModules(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const wanted = new Set(
    input.filter((value): value is string => typeof value === "string"),
  );
  return MODULE_KEYS.filter((key) => wanted.has(key));
}

/** Módulo al que pertenece una ruta, o null si no está gobernada. */
export function moduleKeyForPath(pathname: string): string | null {
  const clean = pathname.split("?")[0].split("#")[0];
  let best: { key: string; length: number } | null = null;

  for (const module of MODULE_CATALOG) {
    for (const href of module.hrefs) {
      const matches = clean === href || clean.startsWith(`${href}/`);
      if (!matches) continue;
      if (!best || href.length > best.length) {
        best = { key: module.key, length: href.length };
      }
    }
  }

  return best?.key ?? null;
}

/**
 * ¿Está habilitado el módulo? Una lista vacía significa "todos",
 * que es el valor heredado de las cuentas anteriores a la 080.
 */
export function isModuleEnabled(
  enabled: readonly string[] | null | undefined,
  key: string | null,
): boolean {
  if (!key) return true;
  if (!enabled || enabled.length === 0) return true;
  return enabled.includes(key);
}

/** Primera ruta visible para el negocio, para redirigir sin dejar a nadie atascado. */
export function firstEnabledHref(
  enabled: readonly string[] | null | undefined,
): string {
  for (const module of MODULE_CATALOG) {
    if (isModuleEnabled(enabled, module.key)) return module.hrefs[0];
  }
  return "/settings";
}

/** Etiquetas de los módulos habilitados, para resúmenes. */
export function enabledModuleLabels(
  enabled: readonly string[] | null | undefined,
): string[] {
  return MODULE_CATALOG.filter((m) => isModuleEnabled(enabled, m.key)).map(
    (m) => m.label,
  );
}
