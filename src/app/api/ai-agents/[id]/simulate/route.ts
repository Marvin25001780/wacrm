import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { runAgentTurn, AgentTurnError } from "@/lib/ai/agent-turn";
import { AiError, type ChatMessage } from "@/lib/ai/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/ai-agents/:id/simulate
 *
 * Un turno del agente EN EL SIMULADOR: misma caja que el motor real
 * (personalidad + conocimiento + protocolo de acciones), pero sin
 * conversación/contacto real — las acciones se REPORTAN ("aplicaría
 * etiqueta X"), no se aplican: no hay contra qué aplicarlas.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await getCurrentAccount();

    const { data: agent, error: agentErr } = await supabase
      .from("ai_agents")
      .select("*")
      .eq("id", id)
      .eq("account_id", accountId)
      .single();
    if (agentErr || !agent) {
      return NextResponse.json(
        { error: agentErr?.message ?? "Agente no encontrado" },
        { status: agentErr ? 500 : 404 },
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const messages = (body.messages ?? []) as ChatMessage[];
    const newMessage = typeof body.newMessage === "string" ? body.newMessage.trim() : "";
    if (!newMessage) {
      return NextResponse.json(
        { error: "El mensaje del usuario es obligatorio" },
        { status: 400 },
      );
    }

    const history = [...messages, { role: "user" as const, content: newMessage }];
    const turn = await runAgentTurn(supabase, agent, history, {
      execute: false, // sin contacto real: se reportan, no se aplican
    });

    return NextResponse.json({
      reply: turn.reply,
      knowledgeLoaded: turn.knowledgeLoaded,
      actions: turn.actions,
    });
  } catch (err) {
    if (err instanceof AgentTurnError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        {
          status: err.code === 'ai_not_configured' || err.code === 'ai_key_unreadable'
            ? 400
            : 502,
        },
      );
    }
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return toErrorResponse(err);
  }
}
