import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

/**
 * POST /api/cobranza/promises/expire
 *
 * Marca rotas las PTP vencidas con pago incompleto, con la fecha local
 * del negocio (migración 131). Sustituye al cron manual de la 076, que
 * comparaba contra UTC. Es idempotente: correrlo dos veces no cambia
 * nada la segunda vez.
 */
export async function POST() {
  try {
    const ctx = await requireRole("admin");

    const { data, error } = await ctx.supabase.rpc("collection_expire_promises", {
      p_account_id: ctx.accountId,
    });

    if (error) {
      if (
        ["42883", "42P01", "42703", "PGRST202", "PGRST205"].includes(
          error.code ?? "",
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Falta aplicar la migración 131_collection_promise_lifecycle.sql para cerrar PTP vencidas.",
            migration: "131",
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "42501" ? 403 : 400 },
      );
    }

    const result = (Array.isArray(data) ? data[0] : data) as
      | { closed?: number; today?: string; timezone?: string }
      | null;

    return NextResponse.json({
      closed: Number(result?.closed) || 0,
      today: result?.today ?? null,
      timezone: result?.timezone ?? null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
