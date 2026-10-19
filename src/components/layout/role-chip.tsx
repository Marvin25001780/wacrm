"use client";

// ============================================================
// RoleChip — the small role pill (Dueño / Admin / Agente /
// Espectador) shown next to a workspace name.
//
// Extracted from the sidebar's account strip when the workspace
// switcher landed: the same pill now renders inside the switcher's
// trigger AND on every row of its list (one per workspace, whose
// role can differ from the active one), so it needs to be a
// component rather than a block of JSX in one file.
//
// The icon/colour table is intentionally a single object: when a
// designer wants to recolour "agent" rows, this is the one diff.
// ============================================================

import { Crown, Shield, User, UserCog, type LucideIcon } from "lucide-react";

import type { AccountRole } from "@/lib/auth/roles";

export const ROLE_CHIP: Record<
  AccountRole,
  { icon: LucideIcon; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: "Dueño",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    label: "Admin",
    // Primary-tinted: significant but not as scarce as owner.
    className: "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    label: "Agente",
    // Neutral slate: the operational default.
    className: "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    label: "Espectador",
    // Muted slate: read-only role; visually quieter than agent.
    className: "border-border bg-card text-muted-foreground",
  },
};

export function RoleChip({
  role,
  className = "",
}: {
  role: AccountRole;
  /** Extra classes for the pill itself (spacing/positioning only —
   *  the colour comes from the table above so every surface matches). */
  className?: string;
}) {
  const meta = ROLE_CHIP[role];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className} ${className}`}
    >
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}
