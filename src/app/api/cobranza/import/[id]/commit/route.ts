import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const { data, error } = await ctx.supabase.rpc("collection_import_commit", {
      p_batch_id: id,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ summary: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
