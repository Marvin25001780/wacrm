// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role and/or their visible name in
//            this workspace.   Role: admin+.  Name: self, or admin+
//            (see the rules in migration 110).
//   DELETE — remove a member.          Admin+.
//
// Role changes delegate to the SECURITY DEFINER RPC from migration
// 018 (`set_member_role`). Display names go through
// `set_member_display_name` (110), because `account_members` only has
// a SELECT policy for the caller's own rows.
//
// The RPCs do the *real* authorisation work — caller must be admin+,
// target must be in caller's account, target can't be the owner (for
// role changes), etc. The TS layer here only forwards the call and
// maps Postgres SQLSTATEs back to HTTP statuses. The one rule it
// repeats is "self can rename themself", which the route has to allow
// even for agents/viewers.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import {
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  canManageMembers,
  isAccountRole,
} from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/** Mismo tope que el CHECK de la 110. */
const MAX_DISPLAY_NAME = 60;

// Map known SQLSTATEs from the RPCs (see migrations 018 and 110) onto
// HTTP statuses. The `error.code` field is the SQLSTATE; the `message`
// is the human-readable RAISE message we put in the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

interface PatchBody {
  role?: unknown;
  display_name?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    // Any member may rename themself, so the route can't require
    // admin up front; the role branch checks it below and the RPC
    // enforces the rest.
    const ctx = await getCurrentAccount();

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as PatchBody | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const updatesRole = Object.prototype.hasOwnProperty.call(body, "role");
    const updatesName = Object.prototype.hasOwnProperty.call(
      body,
      "display_name",
    );

    if (!updatesRole && !updatesName) {
      return NextResponse.json(
        { error: "'role' or 'display_name' is required" },
        { status: 400 },
      );
    }

    // ----------------------------------------------------------
    // Validate everything BEFORE writing, so a request that sends
    // both fields can't half-apply.
    // ----------------------------------------------------------

    let nextRole: string | null = null;
    if (updatesRole) {
      const role = body.role;

      if (!isAccountRole(role)) {
        return NextResponse.json(
          { error: "'role' must be one of owner, admin, agent, viewer" },
          { status: 400 },
        );
      }

      // The RPC blocks promotion to / demotion from owner, but
      // surface the friendlier 400 before crossing the wire too.
      if (role === "owner") {
        return NextResponse.json(
          {
            error:
              "Use POST /api/account/transfer-ownership to promote a member to owner",
          },
          { status: 400 },
        );
      }

      if (!canManageMembers(ctx.role)) {
        return NextResponse.json(
          { error: "Insufficient role" },
          { status: 403 },
        );
      }

      nextRole = role;
    }

    let nextDisplayName: string | null | undefined;
    if (updatesName) {
      const raw = body.display_name;
      if (raw !== null && typeof raw !== "string") {
        return NextResponse.json(
          { error: "'display_name' must be a string or null" },
          { status: 400 },
        );
      }
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (trimmed.length > MAX_DISPLAY_NAME) {
        return NextResponse.json(
          {
            error: `El nombre no puede superar los ${MAX_DISPLAY_NAME} caracteres`,
          },
          { status: 400 },
        );
      }
      // Empty string clears the alias and falls back to the profile.
      nextDisplayName = trimmed === "" ? null : trimmed;
    }

    // ----------------------------------------------------------
    // Apply
    // ----------------------------------------------------------

    let savedDisplayName: string | null | undefined;

    if (nextDisplayName !== undefined) {
      const limit = checkRateLimit(
        `member:displayName:${ctx.userId}`,
        RATE_LIMITS.adminAction,
      );
      if (!limit.success) return rateLimitResponse(limit);

      const { data, error } = await ctx.supabase.rpc(
        "set_member_display_name",
        {
          p_user_id: userId,
          p_display_name: nextDisplayName,
        },
      );

      if (error) return rpcErrorToResponse(error);
      savedDisplayName = (data as string | null) ?? null;
    }

    if (nextRole) {
      const limit = checkRateLimit(
        `admin:memberRole:${ctx.userId}`,
        RATE_LIMITS.adminAction,
      );
      if (!limit.success) return rateLimitResponse(limit);

      const { error } = await ctx.supabase.rpc("set_member_role", {
        p_user_id: userId,
        p_new_role: nextRole,
      });

      if (error) return rpcErrorToResponse(error);
    }

    return NextResponse.json({
      ok: true,
      ...(savedDisplayName !== undefined
        ? { display_name: savedDisplayName }
        : {}),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    if (!canManageMembers(ctx.role)) {
      return NextResponse.json({ error: "Insufficient role" }, { status: 403 });
    }

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
