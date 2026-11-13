// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's ACTIVE account.
//
// Source of truth
//   `account_members` (066), not `profiles`. In the multi-workspace
//   model `profiles` holds one row per person and only stores the
//   account they have active right now; a teammate whose active
//   account is another workspace would vanish from this roster.
//   `account_member_roster()` (109) resolves the roster server-side
//   with SECURITY DEFINER, so profiles RLS does not hide those rows.
//
// Field visibility
//   The RPC nulls `email` for agents/viewers; the route applies the
//   same rule again so the legacy fallback (before 109 is applied)
//   behaves identically. Sensitive fields are returned only to
//   admin+.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import type { AccountMember } from "@/types";

interface RosterRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string;
  joined_at: string;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase.rpc("account_member_roster");

    // Before 109 is applied the RPC does not exist (PGRST202 from
    // PostgREST, 42883 from Postgres). Fall back to the old
    // profiles-based query so the tab keeps working; it is only
    // accurate while every member's active account is this one.
    const rpcMissing =
      error?.code === "PGRST202" || error?.code === "42883";

    let rows: RosterRow[];

    if (error && !rpcMissing) {
      console.error("[GET /api/account/members] roster error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    if (error) {
      console.warn(
        "[GET /api/account/members] account_member_roster() missing; apply migration 109",
      );
      const { data: legacy, error: legacyError } = await ctx.supabase
        .from("profiles")
        .select(
          "user_id, full_name, email, avatar_url, account_role, created_at",
        )
        .eq("account_id", ctx.accountId)
        .order("created_at", { ascending: true });

      if (legacyError) {
        console.error(
          "[GET /api/account/members] legacy fetch error:",
          legacyError,
        );
        return NextResponse.json(
          { error: "Failed to load members" },
          { status: 500 },
        );
      }

      rows = (legacy ?? []).map((row) => ({
        user_id: row.user_id,
        full_name: row.full_name,
        email: row.email,
        avatar_url: row.avatar_url,
        role: row.account_role,
        joined_at: row.created_at,
      }));
    } else {
      rows = (data ?? []) as RosterRow[];
    }

    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = rows.flatMap((row) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.role,
          joined_at: row.joined_at,
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
