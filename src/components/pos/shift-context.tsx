"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";

export interface OpenShift {
  id: string;
  number: number;
  status: "open" | "closed";
  opened_at: string;
  opening_usd: number | string;
  opening_bs: number | string;
  rate_open: number | string;
  register_id?: string | null;
  register?: { name: string | null } | null;
}

interface ShiftContextValue {
  shift: OpenShift | null;
  loading: boolean;
  missing: boolean;
  refresh: () => Promise<void>;
}

const ShiftContext = createContext<ShiftContextValue | null>(null);

/** Evento para avisar a toda la interfaz que el turno cambió. */
export function notifyShiftChanged() {
  window.dispatchEvent(new Event("pos-shift-changed"));
}

export function PosShiftProvider({ children }: { children: ReactNode }) {
  const { accountId, user } = useAuth();
  const [shift, setShift] = useState<OpenShift | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const first = await supabase
      .from("pos_shifts")
      .select(
        "id, number, status, opened_at, opening_usd, opening_bs, rate_open, register_id, register:pos_registers(name)",
      )
      .eq("account_id", accountId)
      .eq("status", "open")
      .eq("opened_by", user?.id ?? "")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!first.error) {
      setMissing(false);
      setShift((first.data as unknown as OpenShift | null) ?? null);
      setLoading(false);
      return;
    }

    // Compatibilidad mientras no se aplica la 099.
    const fallback = await supabase
      .from("pos_shifts")
      .select(
        "id, number, status, opened_at, opening_usd, opening_bs, rate_open",
      )
      .eq("account_id", accountId)
      .eq("status", "open")
      .maybeSingle();

    if (fallback.error) {
      setMissing(true);
      setShift(null);
    } else {
      setMissing(false);
      setShift((fallback.data as OpenShift | null) ?? null);
    }
    setLoading(false);
  }, [accountId, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener("pos-shift-changed", handler);
    return () => window.removeEventListener("pos-shift-changed", handler);
  }, [refresh]);

  return (
    <ShiftContext.Provider value={{ shift, loading, missing, refresh }}>
      {children}
    </ShiftContext.Provider>
  );
}

export function usePosShift(): ShiftContextValue {
  const value = useContext(ShiftContext);
  if (!value) {
    throw new Error("usePosShift debe usarse dentro de PosShiftProvider");
  }
  return value;
}
