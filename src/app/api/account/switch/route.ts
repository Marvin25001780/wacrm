// ============================================================
// POST /api/account/switch
//
//   Body: { account_id: string }
//
// Switches the caller's ACTIVE workspace: the RPC updates
// `profiles.account_id` / `profiles.account_role` to the target
// workspace and the role the caller holds there. Every
// account-scoped query in the app (RLS + `getCurrentAccount`) then
// resolves against that workspace.
//
// Why a POST route for a state change
//   `profiles` is protected by the `protect_profile_tenancy`
//   trigger (S3), which aborts any direct UPDATE that doesn't set
//   `app.tenancy_write` inside its own transaction. The RPC does
//   that internally, so going through it is the only supported
//   path — the trigger makes the alternative impossible rather
//   than merely discouraged.
//
// The CLIENTS (sidebar) must hard-reload after this returns: the
// JWT is unchanged, so neither PostgREST's cache nor the RSC cache
// nor the Realtime channels (subscribed to the old account) are
// invalidated by the switch alone. See `workspace-switcher.tsx`.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    // Either "Unauthorized" (no session — shouldn't happen behind
    // getCurrentAccount) or "Not a member of that account". Both are
    // a real 403 for the caller; the RPC is the authority, so the
    // membership check is not duplicated here.
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error("[POST /api/account/switch] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to switch workspace" },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    // Switching is cheap but it mutates the caller's tenancy, so it
    // shares the admin-action bucket: a loop of switches would thrash
    // every cached query in that browser session.
    const limit = checkRateLimit(
      `account:switch:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { account_id?: unknown }
      | null;
    const accountId = body?.account_id;

    if (typeof accountId !== "string" || !UUID_RE.test(accountId)) {
      return NextResponse.json(
        { error: "'account_id' must be a UUID" },
        { status: 400 },
      );
    }

    // No-op guard: switching to the account already active would
    // rewrite the same row and force a pointless full page reload.
    if (accountId === ctx.accountId) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    const { error } = await ctx.supabase.rpc("switch_active_account", {
      p_account_id: accountId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, accountId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
