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
      // A3 — palancas de acciones
      "action_tags",
      "action_fields",
      "action_assign",
      "action_close",
      "action_notes",
      // A4 — avanzada
      "exit_message",
      "response_quality",
      "max_reply_buttons",
      "max_reminders",
      "follow_up_delay_minutes",
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
    // ---- Validación de los campos A3/A4 ------------------------
    for (const key of ["action_tags", "action_fields", "action_assign", "action_close", "action_notes"]) {
      if (body[key] !== undefined && typeof body[key] !== "boolean") {
        return NextResponse.json({ error: `${key} debe ser booleano` }, { status: 400 });
      }
    }
    if (body.response_quality !== undefined) {
      if (!["concise", "balanced", "detailed"].includes(body.response_quality)) {
        return NextResponse.json({ error: "Calidad de respuesta inválida" }, { status: 400 });
      }
    }
    const intValidations: [string, [number, number]][] = [
      ["max_reply_buttons", [0, 4]],
      ["max_reminders", [0, 5]],
      ["follow_up_delay_minutes", [5, 720]],
    ];
    for (const [key, [min, max]] of intValidations) {
      const v = body[key];
      if (v !== undefined) {
        if (!Number.isInteger(v) || v < min || v > max) {
          return NextResponse.json(
            { error: `${key} debe ser un entero entre ${min} y ${max}` },
            { status: 400 },
          );
        }
      }
    }
    if (body.exit_message !== undefined && body.exit_message !== null) {
      if (typeof body.exit_message !== "string") {
        return NextResponse.json({ error: "exit_message debe ser texto" }, { status: 400 });
      }
      update.exit_message = body.exit_message.trim().slice(0, 2000) || null;
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
