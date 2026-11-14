// ============================================================
// DELETE /api/account/workspaces/[accountId]
//
//   Body: { confirm_name: string }
//
// Deletes a whole workspace, permanently. The real work happens in
// the `delete_workspace` RPC (migration 111), which runs as SECURITY
// DEFINER because `account_members` only exposes a SELECT policy for
// the caller's own rows.
//
// Authorisation
//   The caller must be the OWNER of the target workspace — not just
//   admin of the one they currently have active. The RPC enforces
//   that; this route only forwards and maps errors. It also refuses
//   to delete the caller's last workspace (nobody should end up with
//   no workspace at all).
//
// Why the confirmation name
//   Deleting a workspace cascades to contacts, conversations,
//   messages, pipelines, POS and finance data. Typing the exact name
//   is the guard against a fat-fingered menu click; the RPC compares
//   it server-side too, so a crafted request can't skip it.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  // La migración 111 no está aplicada: mejor decirlo que devolver 500.
  if (err.code === "PGRST202" || err.code === "42883") {
    return NextResponse.json(
      {
        error:
          "La función delete_workspace no existe todavía. Aplica la migración 111.",
      },
      { status: 503 },
    );
  }
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members/workspaces DELETE] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "No se pudo eliminar el negocio" },
    { status: 500 },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(
      `account:deleteWorkspace:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { accountId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { confirm_name?: unknown }
      | null;
    const confirmName = body?.confirm_name;

    if (typeof confirmName !== "string" || confirmName.trim() === "") {
      return NextResponse.json(
        { error: "Escribe el nombre del negocio para confirmar" },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase.rpc("delete_workspace", {
      p_account_id: accountId,
      p_confirm_name: confirmName.trim(),
    });

    if (error) return rpcErrorToResponse(error);

    const result = (data ?? {}) as {
      deleted_account_id?: string;
      was_active?: boolean;
      active_account_id?: string | null;
    };

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
