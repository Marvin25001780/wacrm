import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/ai-agents/:id
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from("ai_agents")
      .select("*")
      .eq("id", id)
      .eq("account_id", accountId)
      .single();
    if (error) throw error;
    return NextResponse.json({ agent: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/ai-agents/:id
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await getCurrentAccount();

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const allowed = [
      "name",
      "description",
      "status",
      "objective",
      "behavior",
      "tone",
      "prohibited_rules",
    ];
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) update[key] = body[key];
    }

    if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim().length === 0)) {
      return NextResponse.json(
        { error: "El nombre del agente es obligatorio" },
        { status: 400 },
      );
    }
    if (
      body.status !== undefined &&
      !["active", "inactive"].includes(body.status)
    ) {
      return NextResponse.json(
        { error: "Estado inválido" },
        { status: 400 },
      );
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No hay campos para actualizar" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("ai_agents")
      .update(update)
      .eq("id", id)
      .eq("account_id", accountId)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "update failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ agent: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/ai-agents/:id
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await getCurrentAccount();
    const { error } = await supabase
      .from("ai_agents")
      .delete()
      .eq("id", id)
      .eq("account_id", accountId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
