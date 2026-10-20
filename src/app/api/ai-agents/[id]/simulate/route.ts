import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { loadAiConfig } from "@/lib/ai/config";
import { generateReply } from "@/lib/ai/generate";
import { buildSystemPrompt } from "@/lib/ai/defaults";
import { buildAgentSystemPrompt } from "@/lib/ai/agent-prompt";
import { AiError, type ChatMessage } from "@/lib/ai/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/ai-agents/:id/simulate
 *
 * Recibe un historial de mensajes y el mensaje nuevo del usuario,
 * y devuelve la respuesta del agente usando la config de IA de la cuenta.
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

    let config: Awaited<ReturnType<typeof loadAiConfig>>;
    try {
      config = await loadAiConfig(supabase, accountId);
    } catch {
      return NextResponse.json(
        {
          error:
            "No se pudo cargar la configuración de IA. Verifica la clave de cifrado o reconfigura el asistente en Configuración → Asistente de IA.",
          code: "ai_config_error",
        },
        { status: 400 },
      );
    }

    if (!config) {
      return NextResponse.json(
        {
          error:
            "El asistente de IA no está configurado. Configúralo en Configuración → Asistente de IA.",
          code: "ai_not_configured",
        },
        { status: 400 },
      );
    }

    const systemPrompt = buildSystemPrompt({
      userPrompt: buildAgentSystemPrompt(agent),
      mode: "auto_reply",
    });

    const { text } = await generateReply({
      config,
      systemPrompt,
      messages: [...messages, { role: "user", content: newMessage }],
    });

    return NextResponse.json({ reply: text });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return toErrorResponse(err);
  }
}
