// ============================================================
// Configuración de navegación principal del CRM — fuente única.
//
// La consumen la barra lateral (para pintar los enlaces) y el
// encabezado (para derivar el título de la página). Mantener una
// sola lista evita que ambas superficies se desincronicen: antes el
// encabezado tenía su propio mapa de títulos y se olvidó de
// `/metrics`, así que esa sección mostraba "Panel".
//
// Estructura agrupada por intención de uso para reducir la carga
// cognitiva: lo operativo queda visible, lo secundario va dentro de
// grupos colapsables.
// ============================================================

import {
  BarChart3,
  Bell,
  Bot,
  Brain,
  Building2,
  CalendarDays,
  CalendarCheck,
  Filter,
  FolderKanban,
  Gauge,
  GitBranch,
  HandCoins,
  History,
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  Paperclip,
  Radio,
  ScrollText,
  Settings,
  Share2,
  ShoppingCart,
  Smartphone,
  StickyNote,
  Target,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";

import type { AccountRole } from "@/lib/auth/roles";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
  /**
   * If present, the item renders as an expandable group in the sidebar
   * with nested children (indented on desktop).
   */
  children?: NavItem[];
  /**
   * Minimum role required to see this item. Uses the same hierarchy as
   * `hasMinRole`: omitting the field means visible to everyone (including
   * viewers); "agent" means agent/admin/owner; "admin" means admin/owner.
   */
  minRole?: AccountRole;
}

// ------------------------------------------------------------
// 1. Principal — acceso directo, alto uso diario.
// ------------------------------------------------------------
const principalNav: NavItem[] = [
  { href: "/dashboard", label: "Panel", icon: LayoutDashboard, minRole: "admin" },
  { href: "/inbox", label: "Bandeja de entrada", icon: MessageSquare },
  { href: "/pos", label: "POS", icon: ShoppingCart, minRole: "agent" },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/organizations", label: "Empresas", icon: Building2, minRole: "admin" },
  { href: "/leads", label: "Leads", icon: Target },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
];

// ------------------------------------------------------------
// 2. Comunicaciones — todos los canales de contacto.
// ------------------------------------------------------------
const comunicacionesNav: NavItem = {
  href: "/channels",
  label: "Comunicaciones",
  icon: MessagesSquare,
  minRole: "admin",
  children: [
    { href: "/channels", label: "Canales", icon: Share2, minRole: "admin" },
    { href: "/sms", label: "SMS", icon: Smartphone, minRole: "admin" },
    { href: "/broadcasts", label: "Campañas", icon: Radio, minRole: "admin" },
    { href: "/chat", label: "Chat interno", icon: MessagesSquare, minRole: "admin" },
    { href: "/notifications", label: "Notificaciones", icon: Bell, minRole: "admin" },
  ],
};

// ------------------------------------------------------------
// 3. Flujos — automatización e IA.
// ------------------------------------------------------------
const flujosNav: NavItem = {
  href: "/flows",
  label: "Flujos",
  icon: Workflow,
  minRole: "admin",
  children: [
    { href: "/flows/bots", label: "Bots", icon: Bot, minRole: "admin" },
    { href: "/automations", label: "Automatizaciones", icon: Zap, minRole: "admin" },
    { href: "/flows/agentes-ia", label: "Agentes de IA", icon: Brain, minRole: "admin" },
  ],
};

// ------------------------------------------------------------
// 4. Operaciones — gestión diaria del trabajo.
// ------------------------------------------------------------
const operacionesNav: NavItem = {
  href: "/calendar",
  label: "Operaciones",
  icon: CalendarCheck,
  minRole: "admin",
  children: [
    { href: "/calendar", label: "Calendario", icon: CalendarDays, minRole: "admin" },
    { href: "/activities", label: "Actividades", icon: CalendarCheck, minRole: "admin" },
    { href: "/spaces", label: "Espacios", icon: FolderKanban, minRole: "admin" },
    { href: "/notes", label: "Notas internas", icon: StickyNote, minRole: "admin" },
    { href: "/attachments", label: "Adjuntos", icon: Paperclip, minRole: "admin" },
    { href: "/timeline", label: "Timeline", icon: History, minRole: "admin" },
  ],
};

// ------------------------------------------------------------
// 5. Analítica — reportes, métricas y control.
// ------------------------------------------------------------
const analiticaNav: NavItem = {
  href: "/metrics",
  label: "Analítica",
  icon: BarChart3,
  minRole: "admin",
  children: [
    { href: "/metrics", label: "Métricas", icon: TrendingUp, minRole: "admin" },
    { href: "/productivity", label: "Productividad", icon: Gauge, minRole: "admin" },
    { href: "/segments", label: "Segmentos", icon: Filter, minRole: "admin" },
    { href: "/audit", label: "Auditoría", icon: ScrollText, minRole: "admin" },
  ],
};

// ------------------------------------------------------------
// 6. Cobranza - cartera, carga masiva, reportes y políticas.
// ------------------------------------------------------------
const cobranzaNav: NavItem = {
  href: "/cobranza",
  label: "Cobranza",
  icon: HandCoins,
  minRole: "agent",
  children: [
    { href: "/cobranza", label: "Panel", icon: LayoutDashboard, minRole: "agent" },
    { href: "/cobranza/cartera", label: "Cartera", icon: Users, minRole: "agent" },
    { href: "/cobranza/pagos", label: "Carga de pagos", icon: Wallet, minRole: "admin" },
    { href: "/cobranza/importar", label: "Carga masiva", icon: Upload, minRole: "admin" },
    { href: "/cobranza/reportes", label: "Reportes", icon: BarChart3, minRole: "admin" },
    { href: "/cobranza/configuracion", label: "Políticas", icon: Settings, minRole: "admin" },
  ],
};

// ------------------------------------------------------------
// Navegación completa.
// ------------------------------------------------------------
export const navItems: NavItem[] = [
  ...principalNav,
  comunicacionesNav,
  flujosNav,
  operacionesNav,
  analiticaNav,
  cobranzaNav,
];

export const bottomNavItems: NavItem[] = [
  { href: "/settings", label: "Configuración", icon: Settings },
];

// ------------------------------------------------------------
// Role-based navigation filtering.
// ------------------------------------------------------------

import { hasMinRole } from "@/lib/auth/roles";
import { isModuleEnabled, moduleKeyForPath } from "@/lib/modules";

/**
 * Returns true if `role` satisfies the item's `minRole` requirement.
 * Items with no `minRole` are visible to everyone.
 */
function isNavItemVisible(item: NavItem, role: AccountRole): boolean {
  return !item.minRole || hasMinRole(role, item.minRole);
}

/**
 * Recursively filter nav items by role and enabled modules. Groups
 * whose `minRole` is not met — or whose module is disabled for the
 * workspace — are dropped entirely; children are filtered
 * independently so a group can be visible while some of its children
 * are hidden.
 */
function filterNavItems(
  items: NavItem[],
  role: AccountRole,
  enabledModules?: readonly string[] | null,
): NavItem[] {
  return items
    .filter(
      (item) =>
        isNavItemVisible(item, role) &&
        isModuleEnabled(enabledModules, moduleKeyForPath(item.href)),
    )
    .map((item) =>
      item.children
        ? {
            ...item,
            children: filterNavItems(item.children, role, enabledModules),
          }
        : item,
    );
}

/** Main nav items visible to the given role.
 *  Viewers see the full navigation (read-only browsing).
 */
export function navItemsForRole(
  role: AccountRole,
  enabledModules?: readonly string[] | null,
): NavItem[] {
  if (role === "viewer")
    return filterNavItems(navItems, "viewer", enabledModules);
  return filterNavItems(navItems, role, enabledModules);
}

/** Bottom nav items visible to the given role.
 *  Viewers see the full navigation (read-only browsing).
 */
export function bottomNavItemsForRole(
  role: AccountRole,
  enabledModules?: readonly string[] | null,
): NavItem[] {
  if (role === "viewer")
    return filterNavItems(bottomNavItems, "viewer", enabledModules);
  return filterNavItems(bottomNavItems, role, enabledModules);
}

/**
 * Find the minimum role required for a path. Checks exact matches first,
 * then prefix matches (so `/contacts/123` inherits `/contacts`).
 * Returns `undefined` if the path is not governed by the nav map.
 */
export function minRoleForPath(pathname: string): AccountRole | undefined {
  const flatten = (items: NavItem[]): NavItem[] =>
    items.flatMap((item) => [
      item,
      ...(item.children ? flatten(item.children) : []),
    ]);
  const all = [...flatten(navItems), ...bottomNavItems];

  const exact = all.find((item) => item.href === pathname);
  if (exact?.minRole) return exact.minRole;

  const byPrefix = all.find((item) => pathname.startsWith(`${item.href}/`));
  return byPrefix?.minRole;
}

/**
 * Título que muestra el encabezado para una ruta.
 *
 * Coincidencia exacta primero (p. ej. `/receivables/reports` →
 * "Reportes de cartera") y, si no, por prefijo de segmento (p. ej.
 * `/metrics/rendimiento` → "Métricas", `/contacts/123` → "Contactos").
 * Cae a "Panel" para rutas desconocidas, igual que antes.
 */
export function pageTitleFor(pathname: string): string {
  const flatten = (items: NavItem[]): NavItem[] =>
    items.flatMap((item) => [
      item,
      ...(item.children ? flatten(item.children) : []),
    ]);
  const all = [...flatten(navItems), ...bottomNavItems];
  const exact = all.find((item) => item.href === pathname);
  if (exact) return exact.label;
  const byPrefix = all.find((item) => pathname.startsWith(`${item.href}/`));
  return byPrefix?.label ?? "Panel";
}
