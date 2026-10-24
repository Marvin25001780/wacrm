import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { status?: string };

    if (!body.status || !["kept", "broken", "cancelled"].includes(body.status)) {
      return NextResponse.json({ error: "Estado de PTP inválido." }, { status: 400 });
    }

    const { data, error } = await ctx.supabase.rpc("collection_resolve_promise", {
      p_promise_id: id,
      p_status: body.status,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ promise: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
