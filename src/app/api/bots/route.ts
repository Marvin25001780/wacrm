import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

/**
 * GET /api/bots
 * Lista los bots de la cuenta con el canal asociado.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from("bots")
      .select("*, channel:channel_configs(channel, config)")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ bots: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/bots
 * Crea un nuevo bot. La versión inicial es 1.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount();
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { name, channel_id } = body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "El nombre del bot es obligatorio" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("bots")
      .insert({
        account_id: accountId,
        created_by_user_id: userId,
        name: name.trim(),
        channel_id: channel_id ?? null,
        status: "inactive",
        version: 1,
      })
      .select("*, channel:channel_configs(channel, config)")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "insert failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ bot: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
