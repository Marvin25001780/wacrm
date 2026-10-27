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
  source: string | null;
  updatedAt: string | null;
  refresh: () => Promise<void>;
  saveRate: (value: number) => Promise<string | null>;
  fetchBcv: () => Promise<string | null>;
}

const PosRateContext = createContext<PosRateValue | null>(null);

/** Fecha de hoy en Venezuela (YYYY-MM-DD). */
export function todayCaracas(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
  }).format(new Date());
}

/**
 * Tasa de cambio del POS.
 *
 * - Usa la última tasa registrada para el negocio.
 * - Si la última es de un día anterior, intenta actualizarla desde el
 *   BCV automáticamente (fuentes comunitarias, ver /api/pos/rate).
 * - El usuario puede forzar la actualización o fijar una manual.
 */
export function PosRateProvider({ children }: { children: ReactNode }) {
  const { accountId } = useAuth();
  const [rate, setRate] = useState(0);
  const [source, setSource] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBcv = useCallback(async (): Promise<string | null> => {
    if (!accountId) return "Sin negocio activo";

    try {
      const res = await fetch("/api/pos/rate", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        rate?: unknown;
        updatedAt?: unknown;
        error?: string;
      };
      if (!res.ok) {
        return json.error ?? "No se pudo consultar el BCV";
      }

      const value = Number(json.rate);
      if (!Number.isFinite(value) || value <= 0) {
        return "El BCV devolvió una tasa inválida";
      }

      const supabase = createClient();
      const { error } = await supabase.from("exchange_rates").upsert(
        {
          account_id: accountId,
          rate_date: todayCaracas(),
          rate: value,
          source: "bcv",
        },
        { onConflict: "account_id,rate_date,source" },
      );
      if (error) return error.message;

      setRate(value);
      setSource("bcv");
      setUpdatedAt(
        typeof json.updatedAt === "string"
          ? json.updatedAt
          : new Date().toISOString(),
      );
      return null;
    } catch {
      return "No se pudo conectar con el BCV";
    }
  }, [accountId]);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);

    const { data: latest } = await supabase
      .from("exchange_rates")
      .select("rate, rate_date, source, created_at")
      .eq("account_id", accountId)
      .order("rate_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest?.rate != null) {
      setRate(toNumber(latest.rate));
      setSource(typeof latest.source === "string" ? latest.source : null);
      setUpdatedAt(
        typeof latest.created_at === "string" ? latest.created_at : null,
      );
    } else {
      const { data: settings } = await supabase
        .from("pos_settings")
        .select("default_rate")
        .eq("account_id", accountId)
        .maybeSingle();

      const value = toNumber(settings?.default_rate);
      if (value > 0) {
        setRate(value);
        setSource(null);
      }
    }

    setLoading(false);

    // Tasa de un día anterior: se intenta actualizar sola.
    if (latest?.rate_date !== todayCaracas()) {
      await fetchBcv();
    }
  }, [accountId, fetchBcv]);

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
      const { error } = await supabase.from("exchange_rates").upsert(
        {
          account_id: accountId,
          rate_date: todayCaracas(),
          rate: value,
          source: "manual",
        },
        { onConflict: "account_id,rate_date,source" },
      );

      if (error) return error.message;

      setRate(value);
      setSource("manual");
      setUpdatedAt(new Date().toISOString());
      return null;
    },
    [accountId],
  );

  return (
    <PosRateContext.Provider
      value={{
        rate,
        loading,
        source,
        updatedAt,
        refresh: load,
        saveRate,
        fetchBcv,
      }}
    >
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
      source: null,
      updatedAt: null,
      refresh: async () => {},
      saveRate: async () => "Fuera del POS",
      fetchBcv: async () => "Fuera del POS",
    };
  }
  return ctx;
}
