import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

export const runtime = "nodejs";

/**
 * GET /api/pos/rate
 *
 * Devuelve la tasa oficial del BCV. No existe una API pública oficial,
 * así que se consultan dos fuentes comunitarias en orden y se usa la
 * primera que responda un número válido.
 */
async function fetchBcv(): Promise<{ rate: number; updatedAt: string | null } | null> {
  try {
    const res = await fetch("https://ve.dolarapi.com/v1/dolares/oficial", {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const rate = Number(json?.promedio);
      if (Number.isFinite(rate) && rate > 0) {
        return {
          rate,
          updatedAt:
            typeof json?.fechaActualizacion === "string"
              ? json.fechaActualizacion
              : null,
        };
      }
    }
  } catch {
    // Sigue con la segunda fuente.
  }

  try {
    const res = await fetch("https://pydolarve.org/api/v1/dollar?page=bcv", {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as {
        monitors?: { bcv?: { price?: unknown } };
        datetime?: unknown;
      } | null;
      const rate = Number(json?.monitors?.bcv?.price);
      if (Number.isFinite(rate) && rate > 0) {
        return {
          rate,
          updatedAt:
            typeof json?.datetime === "string" ? json.datetime : null,
        };
      }
    }
  } catch {
    // Sin fuentes disponibles.
  }

  return null;
}

export async function GET() {
  try {
    await requireRole("agent");

    const result = await fetchBcv();
    if (!result) {
      return NextResponse.json(
        {
          error:
            "No se pudo consultar el BCV. Revisa la tasa manualmente en Ajustes.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        rate: result.rate,
        source: "bcv",
        updatedAt: result.updatedAt ?? new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
