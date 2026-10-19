// ============================================================
// GET /api/account/memberships
//
// Lists every account the caller belongs to, with the role they
// hold in each one and which of them is currently active. Feeds
// the sidebar's workspace switcher (066_account_members.sql).
//
// Why an API route instead of a direct client query
//   The data lives in two tables (`account_members` +
//   `accounts`). The client could read both — RLS allows it — but
//   joining them client-side via PostgREST's embedded syntax makes
//   the query depend on the schema cache resolving the
//   `account_members.account_id → accounts.id` relationship. A
//   stale cache (right after a migration) fails the whole query
//   with PGRST200 and blanks the switcher (same failure mode as
//   issue #294 in `getCurrentAccount`). Two plain lookups here are
//   immune to that, and the ordering/active-flag logic lives in one
//   place for both the sidebar and any future consumer.
//
// Authorisation
//   `account_members_select_own` RLS limits the first query to the
//   caller's own rows, so no extra filtering is needed beyond the
//   `user_id` predicate we add for clarity. Any member can call it
//   — the switcher is useful to every role.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole, type AccountRole } from "@/lib/auth/roles";
import type { WorkspaceMembership } from "@/types";

interface MembershipRow {
  account_id: string;
  role: string;
}

interface AccountRow {
  id: string;
  name: string;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data: memberships, error: membershipErr } = await ctx.supabase
      .from("account_members")
      .select("account_id, role")
      .eq("user_id", ctx.userId);

    if (membershipErr) {
      console.error(
        "[GET /api/account/memberships] membership fetch error:",
        membershipErr,
      );
      return NextResponse.json(
        { error: "Failed to load workspaces" },
        { status: 500 },
      );
    }

    const rows = (memberships ?? []) as MembershipRow[];

    // Resolve names in one query rather than N point lookups.
    // `accounts_select` (066) admits every account the caller is an
    // affiliate of, so this returns exactly the accounts from the
    // memberships above — RLS is the second safety net, not the
    // mechanism.
    const accountIds = rows.map((row) => row.account_id);
    let names = new Map<string, string>();
    if (accountIds.length > 0) {
      const { data: accounts, error: accountErr } = await ctx.supabase
        .from("accounts")
        .select("id, name")
        .in("id", accountIds);

      if (accountErr) {
        console.error(
          "[GET /api/account/memberships] account fetch error:",
          accountErr,
        );
        return NextResponse.json(
          { error: "Failed to load workspaces" },
          { status: 500 },
        );
      }
      names = new Map(
        ((accounts ?? []) as AccountRow[]).map((a) => [a.id, a.name]),
      );
    }

    const workspaces: WorkspaceMembership[] = rows
      // Defensive: the DB enum should make an unknown role
      // impossible, but skip rather than crash if a future migration
      // broadens the enum without updating TS.
      .filter((row) => isAccountRole(row.role))
      .map((row) => ({
        account_id: row.account_id,
        name: names.get(row.account_id) ?? "—",
        role: row.role as AccountRole,
        is_active: row.account_id === ctx.accountId,
      }))
      .sort((a, b) => {
        // Active first, then alphabetical — the switcher's own row
        // should never move under the cursor.
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({ workspaces });
  } catch (err) {
    return toErrorResponse(err);
  }
}
