import { describe, expect, it } from "vitest";

import {
  POS_CAPABILITIES,
  POS_CAPABILITY_KEYS,
  defaultPermission,
  isPosCapability,
  permissionLabel,
  resolvePermissions,
} from "@/lib/pos/permissions";

describe("permisos del POS", () => {
  it("el dueño y el administrador tienen todas las capacidades", () => {
    for (const capability of POS_CAPABILITY_KEYS) {
      expect(defaultPermission("owner", capability)).toBe(true);
      expect(defaultPermission("admin", capability)).toBe(true);
    }
  });

  it("el agente opera el POS pero no administra el negocio", () => {
    expect(defaultPermission("agent", "sell")).toBe(true);
    expect(defaultPermission("agent", "sell_credit")).toBe(true);
    expect(defaultPermission("agent", "manage_catalog")).toBe(true);
    expect(defaultPermission("agent", "manage_finance")).toBe(true);
    expect(defaultPermission("agent", "manage_settings")).toBe(false);
    expect(defaultPermission("agent", "manage_users")).toBe(false);
    expect(defaultPermission("agent", "view_audit")).toBe(false);
    expect(defaultPermission("agent", "manage_credit_limits")).toBe(false);
    expect(defaultPermission("agent", "void_sales")).toBe(false);
  });

  it("el visor solo consulta informes", () => {
    expect(defaultPermission("viewer", "view_reports")).toBe(true);
    expect(defaultPermission("viewer", "sell")).toBe(false);
    expect(defaultPermission("viewer", "manage_shifts")).toBe(false);
  });

  it("un override concede o quita una capacidad sin cambiar el rol", () => {
    const granted = resolvePermissions("agent", { view_audit: true });
    expect(granted.view_audit).toBe(true);
    expect(granted.sell).toBe(true);

    const revoked = resolvePermissions("agent", { sell_credit: false });
    expect(revoked.sell_credit).toBe(false);
    expect(revoked.sell).toBe(true);
  });

  it("cada capacidad tiene etiqueta y todas están catalogadas", () => {
    expect(new Set(POS_CAPABILITY_KEYS).size).toBe(
      POS_CAPABILITY_KEYS.length,
    );
    for (const capability of POS_CAPABILITIES) {
      expect(permissionLabel(capability.key)).toBe(capability.label);
      expect(isPosCapability(capability.key)).toBe(true);
    }
    expect(isPosCapability("hack_the_pos")).toBe(false);
  });
});
