"use client";

// ============================================================
// Contexto de permisos del POS.
//
// Al montar el POS se consulta `pos_my_permissions()` (migración
// 106). Si la migración todavía no está aplicada, se usan los
// valores por defecto del rol para que la interfaz siga siendo
// usable; el servidor seguirá aplicando sus propias guardas.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/hooks/use-auth";
import type { AccountRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";
import {
  isPosCapability,
  resolvePermissions,
  type PosCapability,
} from "@/lib/pos/permissions";

interface PosPermissionsValue {
  loading: boolean;
  /** La migración 106 respondió correctamente. */
  migrationReady: boolean;
  role: AccountRole | null;
  permissions: Record<PosCapability, boolean>;
  can: (capability: PosCapability) => boolean;
  refresh: () => Promise<void>;
}

const PosPermissionsContext = createContext<PosPermissionsValue | null>(null);

export function PosPermissionsProvider({ children }: { children: ReactNode }) {
  const { accountId, accountRole } = useAuth();
  const [permissions, setPermissions] = useState<Record<PosCapability, boolean>>(
    () => resolvePermissions(accountRole),
  );
  const [loading, setLoading] = useState(true);
  const [migrationReady, setMigrationReady] = useState(true);

  const refresh = useCallback(async () => {
    if (!accountId) {
      setPermissions(resolvePermissions(accountRole));
      setLoading(false);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pos_my_permissions");

    if (error || !data) {
      // Sin la migración 106 (o sin red) la interfaz no se bloquea:
      // vuelve a los valores del rol.
      setPermissions(resolvePermissions(accountRole));
      setMigrationReady(false);
      setLoading(false);
      return;
    }

    const raw =
      (data as { permissions?: Record<string, unknown> }).permissions ?? {};
    const overrides: Partial<Record<PosCapability, boolean>> = {};

    for (const [key, value] of Object.entries(raw)) {
      if (isPosCapability(key) && typeof value === "boolean") {
        overrides[key] = value;
      }
    }

    setPermissions(resolvePermissions(accountRole, overrides));
    setMigrationReady(true);
    setLoading(false);
  }, [accountId, accountRole]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const can = useCallback(
    (capability: PosCapability) => permissions[capability] === true,
    [permissions],
  );

  const value = useMemo<PosPermissionsValue>(
    () => ({
      loading,
      migrationReady,
      role: accountRole,
      permissions,
      can,
      refresh,
    }),
    [loading, migrationReady, accountRole, permissions, can, refresh],
  );

  return (
    <PosPermissionsContext.Provider value={value}>
      {children}
    </PosPermissionsContext.Provider>
  );
}

export function usePosPermissions(): PosPermissionsValue {
  const context = useContext(PosPermissionsContext);
  if (!context) {
    throw new Error(
      "usePosPermissions debe usarse dentro de PosPermissionsProvider",
    );
  }
  return context;
}
