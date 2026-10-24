import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function POST() {
  try {
    const ctx = await requireRole("agent");

    const { error } = await ctx.supabase.rpc("collection_recompute_priorities", {
      p_account_id: ctx.accountId,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
