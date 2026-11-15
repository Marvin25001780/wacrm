"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { pageTitleFor } from "@/lib/nav";
import { isModuleEnabled } from "@/lib/modules";
import { useTelephony } from "@/components/telephony/telephony-provider";
import {
  LogOut,
  Menu,
  Phone,
  PhoneCall,
  Settings as SettingsIcon,
  User,
} from "lucide-react";
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
import { ModeToggle } from "@/components/layout/mode-toggle";

// El título se deriva de la misma lista que pinta la barra lateral
// (`@/lib/nav`), así no puede volver a quedarse atrás como cuando
// `/metrics` no estaba en el mapa propio del encabezado y mostraba
// "Panel". Antes también había entradas `/settings?tab=…`: eran código
// muerto, porque `usePathname()` no incluye la query string.

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const pathname = usePathname();
  const { profile, displayName, signOut, accountRole, enabledModules } = useAuth();
  const { open, setOpen, status, phase, elapsedLabel, incomingCall } =
    useTelephony();
  const title = pageTitleFor(pathname);

  const inCall = phase === "connecting" || phase === "ringing" || phase === "active";
  const incomingRinging = Boolean(incomingCall) && !inCall;
  const callActive = inCall || incomingRinging;
  const showPhone =
    accountRole !== "viewer" && isModuleEnabled(enabledModules, "telephony");

  const initial =
    displayName?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Abrir menú"
          className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {showPhone ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={callActive ? "Llamada en curso" : "Abrir teléfono"}
            title={
              incomingRinging
                ? "Llamada entrante"
                : inCall
                  ? "Llamada en curso"
                  : "Teléfono"
            }
            className={
              callActive
                ? "inline-flex h-9 items-center gap-1.5 rounded-md bg-red-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
                : "relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            }
          >
            {callActive ? (
              <PhoneCall className="h-4 w-4" />
            ) : (
              <Phone className="h-4 w-4" />
            )}
            {inCall ? (
              <span className="font-mono tabular-nums">
                {phase === "active" ? elapsedLabel : "…"}
              </span>
            ) : incomingRinging ? (
              <span className="tabular-nums">Entrante</span>
            ) : null}
            {!callActive && status?.presence.online ? (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
            ) : null}
          </button>
        ) : null}

        <ModeToggle />

        <DropdownMenu>
        <DropdownMenuTrigger
          className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/70 focus:bg-muted/70 focus:outline-none data-popup-open:bg-muted/70 sm:gap-3 sm:pl-1 sm:pr-3"
          aria-label="Abrir menú de cuenta"
        >
          <Avatar className="size-8">
            {profile?.avatar_url ? (
              <AvatarImage
                src={profile.avatar_url}
                alt={displayName || "Avatar"}
              />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium text-foreground sm:inline">
            {displayName || "Usuario"}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="min-w-56 bg-popover text-popover-foreground ring-border"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium text-foreground">
              {displayName || "Usuario"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {profile?.email ?? ""}
            </p>
          </div>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=profile"
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
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <SettingsIcon className="size-4" />
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
    </header>
  );
}
