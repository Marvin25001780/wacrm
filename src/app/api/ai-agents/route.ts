import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

/**
 * GET /api/ai-agents
 * Lista los agentes de IA de la cuenta.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const [{ data, error }, { data: replyCounts }] = await Promise.all([
      supabase.from("ai_agents").select("*").eq("account_id", accountId).order("created_at", { ascending: false }),
      // Contador real de respuestas IA (A6): suma de `ai_reply_count`
      // de las conversaciones de la cuenta. Sustituye al "Saldo de
      // Crédito IA: $0" que no respaldaba nada. TODO temporal: mover a
      // un agregado SQL cuando la tabla crezca.
      supabase
        .from("conversations")
        .select("ai_reply_count")
        .eq("account_id", accountId)
        .limit(10000),
    ]);

    if (error) throw error;
    const aiReplies = (replyCounts ?? []).reduce(
      (acc, row) => acc + ((row as { ai_reply_count?: number }).ai_reply_count ?? 0),
      0,
    );
    return NextResponse.json({ agents: data ?? [], aiReplies });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/ai-agents
 * Crea un nuevo agente de IA.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount();
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { name, description, objective, behavior } = body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "El nombre del agente es obligatorio" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("ai_agents")
      .insert({
        account_id: accountId,
        created_by_user_id: userId,
        name: name.trim(),
        description: description ?? null,
        objective: objective ?? null,
        behavior: behavior ?? null,
        status: "inactive",
      })
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "insert failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ agent: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
