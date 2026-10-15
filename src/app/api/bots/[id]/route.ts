import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/bots/:id
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from("bots")
      .select("*, channel:channel_configs(channel, config)")
      .eq("id", id)
      .eq("account_id", accountId)
      .single();
    if (error) throw error;
    return NextResponse.json({ bot: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/bots/:id
 * Actualiza nombre, canal y estado. Cada guardado incrementa la versión.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ctx = await getCurrentAccount();
    const { supabase, accountId } = ctx;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { name, status, channel_id } = body;
    if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
      return NextResponse.json(
        { error: "El nombre del bot es obligatorio" },
        { status: 400 },
      );
    }
    if (status !== undefined && !["active", "inactive"].includes(status)) {
      return NextResponse.json(
        { error: "Estado inválido" },
        { status: 400 },
      );
    }

    // Leer versión actual para incrementarla.
    const { data: current, error: fetchErr } = await supabase
      .from("bots")
      .select("version")
      .eq("id", id)
      .eq("account_id", accountId)
      .single();
    if (fetchErr || !current) {
      return NextResponse.json(
        { error: fetchErr?.message ?? "Bot no encontrado" },
        { status: fetchErr ? 500 : 404 },
      );
    }

    const update: Record<string, unknown> = {
      version: current.version + 1,
    };
    if (name !== undefined) update.name = name.trim();
    if (status !== undefined) update.status = status;
    if (channel_id !== undefined) update.channel_id = channel_id ?? null;

    const { data, error } = await supabase
      .from("bots")
      .update(update)
      .eq("id", id)
      .eq("account_id", accountId)
      .select("*, channel:channel_configs(channel, config)")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "update failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ bot: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/bots/:id
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await getCurrentAccount();
    const { error } = await supabase
      .from("bots")
      .delete()
      .eq("id", id)
      .eq("account_id", accountId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
