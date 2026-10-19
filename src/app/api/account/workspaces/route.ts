// ============================================================
// POST /api/account/workspaces
//
//   Body: { name: string }
//
// Creates a new workspace with the caller as its owner, and makes
// it the caller's ACTIVE workspace (the RPC does both). Returns the
// new account id so the client can hard-reload into it.
//
// Authorisation: admin+ *of the active workspace*, enforced twice —
// `requireRole("admin")` here and again inside the RPC. The RPC's
// check is the one that matters: it runs with the caller's
// `auth.uid()`, so an agent calling the RPC directly (or via a
// hand-crafted request that skips this route) still gets 403. The
// TS guard exists to fail fast and to keep the SQLSTATE mapping in
// one place.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// Matches the account-rename limit in `/api/account` — the same
// string is stored in the same column, so the two must agree.
const MAX_NAME_LEN = 80;

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    // "Only admins can create workspaces" / "Unauthorized".
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    // "Name is required" — the RPC trims, so a whitespace-only
    // name only reaches it if this route's check is bypassed.
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[POST /api/account/workspaces] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to create workspace" },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // Creating workspaces is a rare, structural action. Reuse the
    // admin-action bucket keyed per user so a stuck retry loop can't
    // fill the account list.
    const limit = checkRateLimit(
      `account:createWorkspace:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown }
      | null;
    const rawName = body?.name;

    if (typeof rawName !== "string") {
      return NextResponse.json(
        { error: "'name' must be a string" },
        { status: 400 },
      );
    }

    const name = rawName.trim();
    if (name.length === 0) {
      return NextResponse.json(
        { error: "Workspace name cannot be empty" },
        { status: 400 },
      );
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Workspace name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase.rpc("create_workspace", {
      p_name: name,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, accountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
