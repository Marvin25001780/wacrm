"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  navItemsForRole,
  bottomNavItemsForRole,
  type NavItem,
} from "@/lib/nav";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  ChevronDown,
  Crown,
  LogOut,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  Settings,
  Shield,
  User,
  UserCog,
  UsersRound,
  X,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: "Dueño",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    label: "Admin",
    // Primary-tinted: significant but not as scarce as owner.
    className:
      "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    label: "Agente",
    // Neutral slate: the operational default.
    className:
      "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    label: "Espectador",
    // Muted slate: read-only role; visually quieter than agent.
    className:
      "border-border bg-card text-muted-foreground",
  },
};
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

function isNavActive(pathname: string, href: string): boolean {
  return (
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href))
  );
}

function NavLeaf({
  item,
  pathname,
  totalUnread,
  unreadNotifications,
  indent = false,
  collapsed = false,
}: {
  item: NavItem;
  pathname: string;
  totalUnread: number;
  unreadNotifications: number;
  indent?: boolean;
  collapsed?: boolean;
}) {
  const active = isNavActive(pathname, item.href);
  const showUnreadDot = item.href === "/inbox" && totalUnread > 0 && !active;
  const showNotificationBadge =
    item.href === "/notifications" && unreadNotifications > 0;

  const content = (
    <Link
      href={item.href}
      className={cn(
        // Taller on mobile so fingers can hit the row reliably (≥44px).
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
        indent && !collapsed && "lg:pl-7",
        collapsed && "justify-center px-0 lg:px-0",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span
        className={cn(
          "flex-1",
          collapsed && "sr-only",
        )}
      >
        {item.label}
      </span>
      {!collapsed && item.beta && (
        <span
          aria-label="Beta feature"
          className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
        >
          Beta
        </span>
      )}
      {showUnreadDot && (
        <span
          aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? "" : "s"}`}
          className="relative flex h-2 w-2"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
      )}
      {showNotificationBadge && (
        <span
          aria-label={`${unreadNotifications} unread notification${unreadNotifications === 1 ? "" : "s"}`}
          className={cn(
            "flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground",
            collapsed && "absolute -right-0.5 -top-0.5",
          )}
        >
          {unreadNotifications > 9 ? "9+" : unreadNotifications}
        </span>
      )}
    </Link>
  );

  if (collapsed) {
    return (
      <li className="relative">
        <Tooltip>
          <TooltipTrigger render={content}>{null}</TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      </li>
    );
  }

  return <li>{content}</li>;
}

function NavGroup({
  item,
  pathname,
  collapsed = false,
}: {
  item: NavItem;
  pathname: string;
  collapsed?: boolean;
}) {
  const hasActiveChild = item.children?.some((child) =>
    isNavActive(pathname, child.href),
  );
  const [expanded, setExpanded] = useState(
    () => isNavActive(pathname, item.href) || !!hasActiveChild,
  );
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const parentActive = isNavActive(pathname, item.href);
  const Icon = item.icon;

  // Collapsed mode: icon-only with hover flyout.
  if (collapsed) {
    return (
      <li
        className="relative"
        onMouseEnter={() => setFlyoutOpen(true)}
        onMouseLeave={() => setFlyoutOpen(false)}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={item.href}
                className={cn(
                  "flex items-center justify-center rounded-lg px-3 py-2.5 transition-colors lg:py-2",
                  parentActive || hasActiveChild
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="sr-only">{item.label}</span>
              </Link>
            }
          />
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>

        {flyoutOpen && item.children ? (
          <div className="absolute left-full top-0 z-50 ml-2 w-56 rounded-lg border border-border bg-popover p-2 shadow-md">
            <p className="mb-1 px-2 py-1 text-xs font-semibold text-muted-foreground">
              {item.label}
            </p>
            <ul className="flex flex-col gap-1">
              {item.children.map((child) => (
                <li key={child.href}>
                  <Link
                    href={child.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isNavActive(pathname, child.href)
                        ? "bg-primary/10 text-primary"
                        : "text-popover-foreground hover:bg-muted",
                    )}
                  >
                    <child.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{child.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-1">
      <div
        className={cn(
          "flex items-center rounded-lg",
          (parentActive || hasActiveChild) && "bg-primary/10",
        )}
      >
        <Link
          href={item.href}
          className={cn(
            "flex flex-1 items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
            parentActive || hasActiveChild
              ? "text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="flex-1">{item.label}</span>
          {item.beta && (
            <span
              aria-label="Beta feature"
              className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
            >
              Beta
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Contraer menú" : "Expandir menú"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:h-9 lg:w-9"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-200",
              !expanded && "-rotate-90",
            )}
          />
        </button>
      </div>

      {expanded && item.children ? (
        <ul className="flex flex-col gap-1 lg:pl-7">
          {item.children.map((child) => (
            <NavLeaf
              key={child.href}
              item={child}
              pathname={pathname}
              totalUnread={0}
              unreadNotifications={0}
              indent
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();

  const visibleNavItems = accountRole
    ? navItemsForRole(accountRole)
    : [];
  const visibleBottomItems = accountRole
    ? bottomNavItemsForRole(accountRole)
    : [];
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("sidebar-collapsed") === "true";
  });

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      window.localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };
  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-border bg-card",
          "transition-all duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:translate-x-0",
          collapsed ? "w-64 lg:w-16" : "w-64 lg:w-60",
        )}
        aria-label="Primary"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <Link
            href="/dashboard"
            className={cn(
              "flex items-center gap-2 overflow-hidden transition-opacity",
              collapsed && "opacity-0 lg:hidden",
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessageSquare className="h-4 w-4" />
            </div>
            <span className="whitespace-nowrap text-sm font-semibold text-foreground">
              NEXUS CRM
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
            className={cn(
              "ml-auto flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              collapsed && "mx-auto ml-0 lg:ml-0",
            )}
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Main navigation */}
        <TooltipProvider delay={100}>
          <nav className="flex-1 overflow-y-auto px-3 py-4">
            <ul className="flex flex-col gap-1">
              {profileLoading ? (
                // Skeleton rows avoid the "ghost menu" flash during SSR +
                // hydration while the profile/account_role is still resolving.
                <>
                  <li className="h-10 animate-pulse rounded-lg bg-muted" />
                  <li className="h-10 animate-pulse rounded-lg bg-muted" />
                  <li className="h-10 animate-pulse rounded-lg bg-muted" />
                  <li className="h-10 animate-pulse rounded-lg bg-muted" />
                </>
              ) : (
                visibleNavItems.map((item) =>
                  item.children && item.children.length > 0 ? (
                    <NavGroup
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      collapsed={collapsed}
                    />
                  ) : (
                    <NavLeaf
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      totalUnread={totalUnread}
                      unreadNotifications={unreadNotifications}
                      collapsed={collapsed}
                    />
                  ),
                )
              )}
            </ul>

            <div className="my-4 border-t border-border" />

            <ul className="flex flex-col gap-1">
              {profileLoading ? (
                <li className="h-10 animate-pulse rounded-lg bg-muted" />
              ) : (
                visibleBottomItems.map((item) => {
                  const isActive = pathname.startsWith(item.href);
                  const linkContent = (
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                        collapsed && "justify-center px-0",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className={cn(collapsed && "sr-only")}>
                        {item.label}
                      </span>
                    </Link>
                  );

                  return collapsed ? (
                    <li key={item.href} className="relative">
                      <Tooltip>
                        <TooltipTrigger render={linkContent}>{null}</TooltipTrigger>
                        <TooltipContent side="right">
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  ) : (
                    <li key={item.href}>{linkContent}</li>
                  );
                })
              )}
            </ul>
          </nav>
        </TooltipProvider>

        {/* User section */}
        <div className="shrink-0 border-t border-border p-3">
          {/* Account name display — surfaced only when the account
              name differs from the user's own name (see
              `showAccountStrip`). For a default solo account the two
              match, so we hide it to avoid duplicating the user name
              below; for renamed or shared accounts it tells the user
              which account they're acting in. */}
          {!collapsed && showAccountStrip && account?.name ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-muted-foreground">
              <UsersRound className="size-3.5 shrink-0" />
              {/* `title=` exposes the full name on hover when it
                  gets truncated (long account names + narrow
                  sidebars). Cheap a11y win. */}
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                // Always render the chip — owners used to be
                // invisible here, which made them indistinguishable
                // from admins at a glance. Now everyone sees their
                // role (with a colour cue) regardless of tier.
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {meta.label}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex items-center gap-3 rounded-lg py-2 text-left transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60",
                collapsed
                  ? "w-full justify-center px-0"
                  : "w-full px-3",
              )}
            >
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <div className="flex items-center justify-center">
                        <Avatar className="size-8 shrink-0">
                          {profile?.avatar_url ? (
                            <AvatarImage
                              src={profile.avatar_url}
                              alt={profile.full_name ?? "Avatar"}
                            />
                          ) : null}
                          <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                            {profile?.full_name?.charAt(0)?.toUpperCase() ??
                              profile?.email?.charAt(0)?.toUpperCase() ??
                              "U"}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                    }
                  />
                  <TooltipContent side="right">
                    {profile?.full_name ?? "User"}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Avatar className="size-8 shrink-0">
                  {profile?.avatar_url ? (
                    <AvatarImage
                      src={profile.avatar_url}
                      alt={profile.full_name ?? "Avatar"}
                    />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                    {profile?.full_name?.charAt(0)?.toUpperCase() ??
                      profile?.email?.charAt(0)?.toUpperCase() ??
                      "U"}
                  </AvatarFallback>
                </Avatar>
              )}
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {profile?.full_name ?? "User"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {profile?.email ?? ""}
                  </p>
                </div>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                Perfil
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                Configuración
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
