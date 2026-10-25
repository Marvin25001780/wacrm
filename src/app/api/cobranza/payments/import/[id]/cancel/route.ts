import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const { data: batch, error: batchError } = await ctx.supabase
      .from("collection_payment_imports")
      .select("id, status")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (batchError) throw batchError;
    if (!batch) return NextResponse.json({ error: "Lote no encontrado." }, { status: 404 });
    if (batch.status === "committed") {
      return NextResponse.json(
        { error: "El lote ya fue confirmado; no se puede anular desde aquí." },
        { status: 400 },
      );
    }

    await ctx.supabase
      .from("collection_payment_import_rows")
      .update({ status: "skipped" })
      .eq("batch_id", id)
      .in("status", ["pending", "valid", "warning"]);

    const { error } = await ctx.supabase
      .from("collection_payment_imports")
      .update({ status: "cancelled" })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ cancelled: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
