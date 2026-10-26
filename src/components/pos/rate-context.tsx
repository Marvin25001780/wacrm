"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toNumber } from "@/lib/pos/money";

interface PosRateValue {
  rate: number;
  loading: boolean;
  refresh: () => Promise<void>;
  saveRate: (value: number) => Promise<string | null>;
}

const PosRateContext = createContext<PosRateValue | null>(null);

/**
 * Tasa de cambio del POS: la última registrada para el negocio o la
 * tasa por defecto de `pos_settings`. El POS nunca inventa una tasa:
 * si es 0, la interfaz bloquea el cobro en bolívares.
 */
export function PosRateProvider({ children }: { children: ReactNode }) {
  const { accountId } = useAuth();
  const [rate, setRate] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);

    const { data: latest } = await supabase
      .from("exchange_rates")
      .select("rate")
      .eq("account_id", accountId)
      .order("rate_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest?.rate != null) {
      setRate(toNumber(latest.rate));
      setLoading(false);
      return;
    }

    const { data: settings } = await supabase
      .from("pos_settings")
      .select("default_rate")
      .eq("account_id", accountId)
      .maybeSingle();

    setRate(toNumber(settings?.default_rate));
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveRate = useCallback(
    async (value: number) => {
      if (!accountId) return "Sin negocio activo";
      if (!Number.isFinite(value) || value <= 0) {
        return "La tasa debe ser mayor que cero";
      }

      const supabase = createClient();
      const today = new Date().toISOString().slice(0, 10);

      const { error } = await supabase.from("exchange_rates").upsert(
        {
          account_id: accountId,
          rate_date: today,
          rate: value,
          source: "manual",
        },
        { onConflict: "account_id,rate_date,source" },
      );

      if (error) return error.message;

      setRate(value);
      return null;
    },
    [accountId],
  );

  return (
    <PosRateContext.Provider value={{ rate, loading, refresh: load, saveRate }}>
      {children}
    </PosRateContext.Provider>
  );
}

export function usePosRate(): PosRateValue {
  const ctx = useContext(PosRateContext);
  if (!ctx) {
    return {
      rate: 0,
      loading: false,
      refresh: async () => {},
      saveRate: async () => "Fuera del POS",
    };
  }
  return ctx;
}
