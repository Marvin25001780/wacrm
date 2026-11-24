import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

const VALID_STATUSES = ["pending", "kept", "broken", "cancelled"] as const;

/**
 * POST /api/cobranza/promises/[id]/resolve
 *
 * Cierra una PTP (`kept`, `broken`, `cancelled`) o la reabre
 * (`pending`, solo supervisión). La RPC de la 131 decide quién puede
 * hacerlo: admin/owner, el gestor asignado al deudor o quien creó la
 * promesa. Aquí solo se traducen los errores de Postgres a HTTP.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { status?: string };

    if (
      !body.status ||
      !VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])
    ) {
      return NextResponse.json(
        { error: "Estado de PTP inválido." },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase.rpc("collection_resolve_promise", {
      p_promise_id: id,
      p_status: body.status,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForError(error.code) },
      );
    }

    return NextResponse.json({ promise: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function statusForError(code: string | undefined): number {
  switch (code) {
    case "42501":
      return 403;
    case "P0002":
      return 404;
    case "P0001":
      return 409;
    case "22023":
      return 400;
    default:
      return 400;
  }
}
