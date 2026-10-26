"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { OnboardingWizard, isOnboardingPending } from "@/components/onboarding/onboarding-wizard";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { minRoleForPath } from "@/lib/nav";
import { hasMinRole, type AccountRole } from "@/lib/auth/roles";
import {
  MODULE_CATALOG,
  isModuleEnabled,
  moduleKeyForPath,
} from "@/lib/modules";

/**
 * Primera ruta permitida por módulos Y por rol. Evita el bucle entre
 * el guardia de módulos y el de roles (p. ej. un agente con solo
 * "Analítica" habilitada, que es admin-only).
 */
function safeFallback(
  enabled: readonly string[],
  role: AccountRole | null,
): string {
  for (const module of MODULE_CATALOG) {
    if (!isModuleEnabled(enabled, module.key)) continue;
    const href = module.hrefs[0];
    const required = minRoleForPath(href);
    if (!required) return href;
    if (role === "viewer") return href;
    if (role && hasMinRole(role, required)) return href;
  }
  return "/settings";
}

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const {
    user,
    loading,
    accountRole,
    account,
    profile,
    canEditSettings,
    enabledModules,
  } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
      return;
    }

    // Role-based route guard: agents cannot access admin-only sections.
    // Viewers browse everywhere in read-only mode; individual pages gate
    // their own write actions. Settings sub-sections are handled inside
    // /settings.
    if (!loading && user && accountRole && pathname && accountRole !== "viewer") {
      const requiredRole = minRoleForPath(pathname);
      if (requiredRole && !hasMinRole(accountRole, requiredRole)) {
        router.replace("/inbox");
        return;
      }
    }

    // Guardia por módulos: si el negocio no tiene habilitada la
    // sección, redirige a la primera disponible.
    if (!loading && user && account && pathname) {
      const key = moduleKeyForPath(pathname);
      if (key && !isModuleEnabled(enabledModules, key)) {
        router.replace(safeFallback(enabledModules, accountRole));
      }
    }
  }, [user, loading, accountRole, account, pathname, router, enabledModules]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // Wizard de bienvenida: LARGO mientras el perfil no tenga sello
  // (068) y, si ya lo tiene, CORTO para el negocio sin sellar (069).
  // En el corto solo entra un admin+: es el que puede responder por la
  // cuenta (un agente/visor recibirá 403 al guardar). Completar y
  // saltar sellan, así que cada uno aparece una única vez.
  const onboardingPending =
    !!profile && isOnboardingPending(profile.onboarding_completed_at);
  const shortPending =
    !onboardingPending &&
    !!account &&
    isOnboardingPending(account.onboarding_completed_at) &&
    canEditSettings === true;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Wizard de bienvenida (068 largo / 069 corto) mientras el
          sello correspondiente esté en NULL. Se pinta sobre la pantalla
          en la que estés — igual que Kommo. El `key` obliga a una
          instancia nueva cuando cambia de modo: el salto del largo
          sella al usuario y, al instante, entra el corto del negocio —
          sin reiniciar, el componente heredaría el paso actual y
          quedaría fuera de su propia secuencia. */}
      {onboardingPending || shortPending ? (
        <OnboardingWizard key={onboardingPending ? "long" : "short"} />
      ) : null}
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
