import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  agentChannels,
  isAiAgentChannel,
  normalizeAiAgentChannels,
} from "@/lib/ai/channels";
import { loadAiChannelStatus } from "@/lib/ai/channel-status";

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
    const [{ data, error }, channelStatus] = await Promise.all([
      supabase
        .from("ai_agents")
        .select("*")
        .eq("id", id)
        .eq("account_id", accountId)
        .single(),
      loadAiChannelStatus(supabase, accountId),
    ]);
    if (error) throw error;
    return NextResponse.json({ agent: data, channelStatus });
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

    const { data: current, error: currentErr } = await supabase
      .from("ai_agents")
      .select("status, channels")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (currentErr) throw currentErr;
    if (!current) {
      return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
    }

    const allowed = [
      "name",
      "description",
      "status",
      "channels",
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

    // ---- Canales del agente ------------------------------------
    // El array se guarda normalizado y sin duplicados. Un agente
    // activo no puede quedarse sin canales ni activarse solo con
    // canales que todavía no están conectados.
    if (body.channels !== undefined) {
      if (!Array.isArray(body.channels)) {
        return NextResponse.json(
          { error: "channels debe ser una lista de canales" },
          { status: 400 },
        );
      }
      if (body.channels.length === 0) {
        return NextResponse.json(
          { error: "Selecciona al menos un canal para el agente" },
          { status: 400 },
        );
      }
      if (body.channels.some((channel: unknown) => !isAiAgentChannel(channel))) {
        return NextResponse.json(
          { error: "Hay un canal no permitido en la selección" },
          { status: 400 },
        );
      }
      update.channels = normalizeAiAgentChannels(body.channels);
    }

    const currentStatus = current.status as "active" | "inactive";
    const nextStatus =
      body.status === undefined ? currentStatus : (body.status as "active" | "inactive");
    const nextChannels =
      body.channels === undefined
        ? agentChannels(current.channels)
        : normalizeAiAgentChannels(body.channels);

    const needsConnectedChannel =
      nextStatus === "active" &&
      (body.status === "active" || body.channels !== undefined);

    if (needsConnectedChannel) {
      const channelStatus = await loadAiChannelStatus(supabase, accountId);
      if (!nextChannels.some((channel) => channelStatus[channel])) {
        return NextResponse.json(
          {
            error:
              "Selecciona al menos un canal conectado para activar el agente",
          },
          { status: 400 },
        );
      }
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

    // Un solo agente activo por cuenta: el motor elige el más antiguo
    // y dos agentes activos dejan canales sin dueño claro. Al activar
    // uno, los demás se apagan.
    if (nextStatus === "active") {
      const { error: deactivateErr } = await supabase
        .from("ai_agents")
        .update({ status: "inactive" })
        .eq("account_id", accountId)
        .eq("status", "active")
        .neq("id", id);
      if (deactivateErr) {
        console.error(
          "[ai-agents] no se pudieron desactivar los otros agentes:",
          deactivateErr.message,
        );
      }
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
