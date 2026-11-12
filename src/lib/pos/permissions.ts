// ============================================================
// Permisos del POS — fuente única en TypeScript.
//
// La autoridad real es la base de datos (`pos_default_permission` +
// `pos_can_for`), pero la interfaz necesita los mismos nombres y
// valores por defecto para no mostrar acciones que el servidor va
// a rechazar. Si cambia una capacidad, se cambia en los dos lados.
// ============================================================

import type { AccountRole } from "@/lib/auth/roles";

export type PosCapability =
  | "sell"
  | "sell_credit"
  | "apply_discount"
  | "collect_credit"
  | "issue_returns"
  | "issue_invoices"
  | "void_sales"
  | "manage_customers"
  | "manage_catalog"
  | "manage_inventory"
  | "manage_finance"
  | "view_reports"
  | "manage_shifts"
  | "manage_settings"
  | "manage_users"
  | "view_audit"
  | "manage_credit_limits";

export type PosCapabilityGroup = "Ventas" | "Operación" | "Control";

export interface PosCapabilityInfo {
  key: PosCapability;
  label: string;
  description: string;
  group: PosCapabilityGroup;
}

export const POS_CAPABILITIES: readonly PosCapabilityInfo[] = [
  {
    key: "sell",
    label: "Vender",
    description: "Crear ventas y cobrar en el POS.",
    group: "Ventas",
  },
  {
    key: "sell_credit",
    label: "Vender a crédito",
    description: "Dejar saldo pendiente a un cliente.",
    group: "Ventas",
  },
  {
    key: "apply_discount",
    label: "Descuentos y recargos",
    description: "Aplicar códigos de descuento o recargos a una venta.",
    group: "Ventas",
  },
  {
    key: "collect_credit",
    label: "Cobrar abonos",
    description: "Registrar pagos de ventas con saldo pendiente.",
    group: "Ventas",
  },
  {
    key: "issue_returns",
    label: "Devoluciones",
    description: "Registrar devoluciones y notas de crédito.",
    group: "Ventas",
  },
  {
    key: "issue_invoices",
    label: "Facturación fiscal",
    description: "Emitir facturas y notas de crédito fiscales.",
    group: "Ventas",
  },
  {
    key: "void_sales",
    label: "Anular ventas",
    description: "Marcar una venta como anulada.",
    group: "Ventas",
  },
  {
    key: "manage_customers",
    label: "Contactos",
    description: "Crear y editar clientes del POS.",
    group: "Operación",
  },
  {
    key: "manage_catalog",
    label: "Catálogo y precios",
    description: "Productos, categorías, listas de precios, canales y promociones.",
    group: "Operación",
  },
  {
    key: "manage_inventory",
    label: "Inventario y compras",
    description: "Compras, ajustes, conteos y mermas.",
    group: "Operación",
  },
  {
    key: "manage_finance",
    label: "Cuentas y gastos",
    description: "Cuentas, gastos, transferencias y cuentas por pagar.",
    group: "Operación",
  },
  {
    key: "view_reports",
    label: "Informes",
    description: "Ver ventas, inventario, finanzas y punto de equilibrio.",
    group: "Operación",
  },
  {
    key: "manage_shifts",
    label: "Turnos y caja",
    description: "Abrir, cerrar y arquear turnos; administrar cajas.",
    group: "Operación",
  },
  {
    key: "manage_settings",
    label: "Ajustes del negocio",
    description: "Datos fiscales, moneda, impuestos y formato del recibo.",
    group: "Control",
  },
  {
    key: "manage_users",
    label: "Usuarios y permisos",
    description: "Invitar al equipo y ajustar permisos individuales.",
    group: "Control",
  },
  {
    key: "view_audit",
    label: "Bitácora",
    description: "Consultar el historial de cambios del POS.",
    group: "Control",
  },
  {
    key: "manage_credit_limits",
    label: "Límites de crédito",
    description: "Asignar o cambiar el límite de crédito de un cliente.",
    group: "Control",
  },
] as const;

export const POS_CAPABILITY_KEYS: readonly PosCapability[] =
  POS_CAPABILITIES.map((capability) => capability.key);

const CAPABILITY_BY_KEY = new Map<PosCapability, PosCapabilityInfo>(
  POS_CAPABILITIES.map((capability) => [capability.key, capability]),
);

/** Capacidades que el rol tiene por defecto, sin overrides. */
export const POS_DEFAULT_PERMISSIONS: Record<
  AccountRole,
  readonly PosCapability[]
> = {
  owner: POS_CAPABILITY_KEYS,
  admin: POS_CAPABILITY_KEYS,
  agent: [
    "sell",
    "sell_credit",
    "apply_discount",
    "collect_credit",
    "issue_returns",
    "issue_invoices",
    "manage_customers",
    "manage_catalog",
    "manage_inventory",
    "manage_finance",
    "view_reports",
    "manage_shifts",
  ],
  viewer: ["view_reports"],
};

export function defaultPermission(
  role: AccountRole | null | undefined,
  capability: PosCapability,
): boolean {
  if (!role) return false;
  return POS_DEFAULT_PERMISSIONS[role].includes(capability);
}

export function permissionLabel(capability: PosCapability): string {
  return CAPABILITY_BY_KEY.get(capability)?.label ?? capability;
}

export function permissionInfo(
  capability: PosCapability,
): PosCapabilityInfo | undefined {
  return CAPABILITY_BY_KEY.get(capability);
}

export function isPosCapability(value: unknown): value is PosCapability {
  return (
    typeof value === "string" &&
    (POS_CAPABILITY_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Construye el mapa efectivo de permisos a partir del rol y de los
 * overrides que devuelve la base de datos.
 */
export function resolvePermissions(
  role: AccountRole | null | undefined,
  overrides: Partial<Record<PosCapability, boolean>> = {},
): Record<PosCapability, boolean> {
  const resolved = {} as Record<PosCapability, boolean>;
  for (const capability of POS_CAPABILITY_KEYS) {
    const override = overrides[capability];
    resolved[capability] =
      typeof override === "boolean" ? override : defaultPermission(role, capability);
  }
  return resolved;
}

/** Agrupa las capacidades para la matriz de Ajustes. */
export function capabilitiesByGroup(): {
  group: PosCapabilityGroup;
  items: PosCapabilityInfo[];
}[] {
  const groups: PosCapabilityGroup[] = ["Ventas", "Operación", "Control"];
  return groups.map((group) => ({
    group,
    items: POS_CAPABILITIES.filter((capability) => capability.group === group),
  }));
}
