"use client";

// ============================================================
// Sub-navegación del módulo de Métricas.
//
// Barra de pestañas (horizontal, con scroll en pantallas estrechas)
// con las secciones: Conversaciones, Rendimiento, Ventas, Llamadas,
// Agentes IA, Uso de Meta y Widget.
// ============================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Gauge,
  HandCoins,
  MessageSquare,
  Phone,
  Wallet,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricsTab {
  href: string;
  label: string;
  icon: LucideIcon;
}

const TABS: MetricsTab[] = [
  { href: "/metrics", label: "Conversaciones", icon: MessageSquare },
  { href: "/metrics/rendimiento", label: "Rendimiento", icon: Gauge },
  { href: "/metrics/ventas", label: "Ventas", icon: HandCoins },
  { href: "/metrics/llamadas", label: "Llamadas", icon: Phone },
  { href: "/metrics/agentes-ia", label: "Agentes IA", icon: Bot },
  { href: "/metrics/uso-meta", label: "Uso de Meta", icon: Wallet },
  { href: "/metrics/widget", label: "Widget", icon: Globe },
];

export function MetricsSubnav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
      {TABS.map((tab) => {
        const active =
          tab.href === "/metrics"
            ? pathname === "/metrics"
            : pathname.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
