import { describe, expect, it } from "vitest";

import {
  MODULE_CATALOG,
  allModuleKeys,
  enabledModuleLabels,
  firstEnabledHref,
  isModuleEnabled,
  moduleKeyForPath,
  normalizeModules,
} from "./modules";

describe("catálogo de módulos", () => {
  it("no repite claves ni rutas", () => {
    const keys = MODULE_CATALOG.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);

    const hrefs = MODULE_CATALOG.flatMap((m) => m.hrefs);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("resuelve rutas hijas al módulo correcto", () => {
    expect(moduleKeyForPath("/cobranza/cartera")).toBe("collections");
    expect(moduleKeyForPath("/metrics/rendimiento")).toBe("analytics");
    expect(moduleKeyForPath("/contacts/123")).toBe("contacts");
    expect(moduleKeyForPath("/settings")).toBeNull();
  });

  it("trata una lista vacía como 'todos'", () => {
    expect(isModuleEnabled([], "inbox")).toBe(true);
    expect(isModuleEnabled(null, "inbox")).toBe(true);
    expect(isModuleEnabled(["inbox"], "collections")).toBe(false);
  });

  it("normaliza el orden y descarta claves desconocidas", () => {
    expect(normalizeModules(["collections", "inbox", "nope"])).toEqual([
      "inbox",
      "collections",
    ]);
    expect(normalizeModules("inbox")).toEqual([]);
  });

  it("elige la primera ruta habilitada", () => {
    expect(firstEnabledHref([])).toBe("/dashboard");
    expect(firstEnabledHref(["collections"])).toBe("/cobranza");
    expect(enabledModuleLabels(["inbox"])).toEqual(["Bandeja de entrada"]);
  });

  it("todas las claves del catálogo son estables", () => {
    expect(allModuleKeys()).toEqual(MODULE_CATALOG.map((m) => m.key));
  });
});
