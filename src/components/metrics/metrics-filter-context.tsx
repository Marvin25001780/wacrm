"use client";

// ============================================================
// Contexto de filtros del módulo de Métricas.
//
// Vive en el layout `/metrics` para que los filtros se mantengan al
// cambiar de sección (Conversaciones, Rendimiento, …). Mantiene dos
// estados:
//   • `draft`   — lo que el usuario está editando.
//   • `applied` — lo que ya se aplicó con el botón "Aplicar" y que
//                 consumen los reportes.
// "Restablecer" devuelve ambos al estado inicial.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  resolveRange,
  type PeriodPreset,
  type ResolvedRange,
} from "@/lib/metrics/period";

export interface MetricsFilterState {
  preset: PeriodPreset;
  customStart: string;
  customEnd: string;
  /** "all" o el id del perfil (profiles.id). */
  agentId: string;
  /** "all" o el id del equipo. */
  teamId: string;
  /** "all" o la clave del canal (whatsapp, instagram, …). */
  channel: string;
  /** "all" o el tipo de conversación. */
  type: string;
}

export interface AgentOption {
  id: string;
  userId: string | null;
  name: string;
  email: string;
}

export interface TeamOption {
  id: string;
  name: string;
}

export const DEFAULT_FILTERS: MetricsFilterState = {
  preset: "7",
  customStart: "",
  customEnd: "",
  agentId: "all",
  teamId: "all",
  channel: "all",
  type: "all",
};

interface MetricsFilterContextValue {
  draft: MetricsFilterState;
  applied: MetricsFilterState;
  range: ResolvedRange;
  agents: AgentOption[];
  teams: TeamOption[];
  setDraft: (patch: Partial<MetricsFilterState>) => void;
  apply: () => void;
  reset: () => void;
  isDirty: boolean;
}

const MetricsFilterContext = createContext<MetricsFilterContextValue | null>(
  null
);

export function MetricsFilterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const { accountId, profileLoading } = useAuth();

  const [draft, setDraftState] = useState<MetricsFilterState>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<MetricsFilterState>(DEFAULT_FILTERS);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);

  const setDraft = useCallback((patch: Partial<MetricsFilterState>) => {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const apply = useCallback(() => {
    setApplied(draft);
  }, [draft]);

  const reset = useCallback(() => {
    setDraftState(DEFAULT_FILTERS);
    setApplied(DEFAULT_FILTERS);
  }, []);

  const range = useMemo(
    () =>
      resolveRange(
        applied.preset,
        applied.customStart,
        applied.customEnd
      ),
    [applied.preset, applied.customStart, applied.customEnd]
  );

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(applied),
    [draft, applied]
  );

  // Catálogos para los desplegables (agentes y equipos).
  useEffect(() => {
    if (profileLoading || !accountId) return;
    let cancelled = false;

    (async () => {
      const [profRes, teamRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, user_id, full_name, email")
          .eq("account_id", accountId)
          .order("full_name", { ascending: true }),
        supabase
          .from("teams")
          .select("id, name")
          .eq("account_id", accountId)
          .order("name", { ascending: true }),
      ]);
      if (cancelled) return;

      const profs = (profRes.data ?? []) as Array<{
        id: string;
        user_id: string | null;
        full_name: string | null;
        email: string | null;
      }>;
      setAgents(
        profs.map((p) => ({
          id: p.id,
          userId: p.user_id,
          name: (p.full_name && p.full_name.trim()) || p.email || "Sin nombre",
          email: p.email ?? "",
        }))
      );

      // La tabla `teams` puede no existir aún en entornos sin migrar;
      // en ese caso simplemente no hay equipos.
      if (teamRes.error) setTeams([]);
      else
        setTeams(
          ((teamRes.data ?? []) as Array<{ id: string; name: string }>).map(
            (t) => ({ id: t.id, name: t.name })
          )
        );
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, profileLoading, supabase]);

  const value = useMemo<MetricsFilterContextValue>(
    () => ({
      draft,
      applied,
      range,
      agents,
      teams,
      setDraft,
      apply,
      reset,
      isDirty,
    }),
    [draft, applied, range, agents, teams, setDraft, apply, reset, isDirty]
  );

  return (
    <MetricsFilterContext.Provider value={value}>
      {children}
    </MetricsFilterContext.Provider>
  );
}

export function useMetricsFilters(): MetricsFilterContextValue {
  const ctx = useContext(MetricsFilterContext);
  if (!ctx) {
    throw new Error(
      "useMetricsFilters debe usarse dentro de <MetricsFilterProvider>"
    );
  }
  return ctx;
}
