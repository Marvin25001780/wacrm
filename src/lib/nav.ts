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
  Smartphone,
  StickyNote,
  Target,
  TrendingUp,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

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
}

// ------------------------------------------------------------
// 1. Principal — acceso directo, alto uso diario.
// ------------------------------------------------------------
const principalNav: NavItem[] = [
  { href: "/dashboard", label: "Panel", icon: LayoutDashboard },
  { href: "/inbox", label: "Bandeja de entrada", icon: MessageSquare },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/organizations", label: "Empresas", icon: Building2 },
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
  children: [
    { href: "/channels", label: "Canales", icon: Share2 },
    { href: "/sms", label: "SMS", icon: Smartphone },
    { href: "/broadcasts", label: "Campañas", icon: Radio },
    { href: "/chat", label: "Chat interno", icon: MessagesSquare },
    { href: "/notifications", label: "Notificaciones", icon: Bell },
  ],
};

// ------------------------------------------------------------
// 3. Flujos — automatización e IA.
// ------------------------------------------------------------
const flujosNav: NavItem = {
  href: "/flows",
  label: "Flujos",
  icon: Workflow,
  children: [
    { href: "/flows/bots", label: "Bots", icon: Bot },
    { href: "/automations", label: "Automatizaciones", icon: Zap },
    { href: "/flows/agentes-ia", label: "Agentes de IA", icon: Brain },
  ],
};

// ------------------------------------------------------------
// 4. Operaciones — gestión diaria del trabajo.
// ------------------------------------------------------------
const operacionesNav: NavItem = {
  href: "/calendar",
  label: "Operaciones",
  icon: CalendarCheck,
  children: [
    { href: "/calendar", label: "Calendario", icon: CalendarDays },
    { href: "/activities", label: "Actividades", icon: CalendarCheck },
    { href: "/spaces", label: "Espacios", icon: FolderKanban },
    { href: "/notes", label: "Notas internas", icon: StickyNote },
    { href: "/attachments", label: "Adjuntos", icon: Paperclip },
    { href: "/timeline", label: "Timeline", icon: History },
  ],
};

// ------------------------------------------------------------
// 5. Analítica — reportes, métricas y control.
// ------------------------------------------------------------
const analiticaNav: NavItem = {
  href: "/metrics",
  label: "Analítica",
  icon: BarChart3,
  children: [
    { href: "/metrics", label: "Métricas", icon: TrendingUp },
    { href: "/productivity", label: "Productividad", icon: Gauge },
    { href: "/segments", label: "Segmentos", icon: Filter },
    { href: "/audit", label: "Auditoría", icon: ScrollText },
  ],
};

// ------------------------------------------------------------
// 6. Finanzas — cobranza y reportes financieros.
// ------------------------------------------------------------
const finanzasNav: NavItem = {
  href: "/receivables",
  label: "Finanzas",
  icon: HandCoins,
  children: [
    { href: "/receivables", label: "Cobranza", icon: HandCoins },
    { href: "/receivables/reports", label: "Reportes de cartera", icon: BarChart3 },
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
  finanzasNav,
];

export const bottomNavItems: NavItem[] = [
  { href: "/settings", label: "Configuración", icon: Settings },
];

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
