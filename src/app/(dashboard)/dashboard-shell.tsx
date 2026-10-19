"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { OnboardingWizard, isOnboardingPending } from "@/components/onboarding/onboarding-wizard";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { minRoleForPath } from "@/lib/nav";
import { hasMinRole } from "@/lib/auth/roles";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, accountRole, profile } = useAuth();
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
      }
    }
  }, [user, loading, accountRole, pathname, router]);

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

  // Wizard de bienvenida (068): se monta mientras el perfil no tenga el
  // sello de onboarding (`onboarding_completed_at` = NULL). Lo completan
  // y lo saltan por la misma puerta — ambos sellan, así que aparece una
  // única vez por usuario.
  const onboardingPending =
    !!profile && isOnboardingPending(profile.onboarding_completed_at);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Wizard de bienvenida (068) mientras el perfil esté sin sello.
          Se pinta sobre la pantalla en la que estés — igual que Kommo. */}
      {onboardingPending ? <OnboardingWizard /> : null}
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
