// ============================================================
// Configuración de navegación principal del CRM — fuente única.
//
// La consumen la barra lateral (para pintar los enlaces) y el
// encabezado (para derivar el título de la página). Mantener una
// sola lista evita que ambas superficies se desincronicen: antes el
// encabezado tenía su propio mapa de títulos y se olvidó de
// `/metrics`, así que esa sección mostraba "Panel".
// ============================================================

import {
  BarChart3,
  Bell,
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
}

export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Panel", icon: LayoutDashboard },
  { href: "/inbox",     label: "Bandeja de entrada", icon: MessageSquare },
  { href: "/sms", label: "SMS", icon: Smartphone },
  { href: "/channels", label: "Canales", icon: Share2 },
  { href: "/notifications",     label: "Notificaciones", icon: Bell },
  { href: "/calendar",     label: "Calendario", icon: CalendarDays },
  { href: "/contacts",     label: "Contactos", icon: Users },
  { href: "/organizations", label: "Empresas", icon: Building2 },
  { href: "/leads",         label: "Leads", icon: Target },
  { href: "/activities",    label: "Actividades", icon: CalendarCheck },
  { href: "/notes",         label: "Notas internas", icon: StickyNote },
  { href: "/attachments",   label: "Adjuntos", icon: Paperclip },
  { href: "/timeline",      label: "Timeline", icon: History },
  { href: "/spaces",        label: "Espacios", icon: FolderKanban },
  { href: "/receivables",   label: "Cobranza", icon: HandCoins },
  { href: "/receivables/reports", label: "Reportes de cartera", icon: BarChart3 },
  { href: "/chat",          label: "Chat interno", icon: MessagesSquare },
  { href: "/productivity",  label: "Productividad", icon: Gauge },
  { href: "/metrics",       label: "Métricas", icon: TrendingUp },
  { href: "/audit",         label: "Auditoría", icon: ScrollText },
  { href: "/segments",      label: "Segmentos", icon: Filter },
  { href: "/pipelines",     label: "Pipelines", icon: GitBranch },
  { href: "/broadcasts",     label: "Campañas", icon: Radio },
  { href: "/automations",     label: "Automatizaciones", icon: Zap },
  { href: "/flows",     label: "Flujos", icon: Workflow, beta: true },
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
  const all = [...navItems, ...bottomNavItems];
  const exact = all.find((item) => item.href === pathname);
  if (exact) return exact.label;
  const byPrefix = all.find((item) => pathname.startsWith(`${item.href}/`));
  return byPrefix?.label ?? "Panel";
}
