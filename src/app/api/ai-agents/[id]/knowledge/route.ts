import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/ai-agents/:id/knowledge
 *
 * Todo lo que el editor de Conocimiento necesita en una consulta:
 *   - fuentes de la CUENTA (base compartida) cada una marcada si este
 *     agente la tiene ACTIVADA,
 *   - pares de Q&A de la cuenta,
 *   -运转 el contador "N fuentes activadas" que pinta la UI.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await getCurrentAccount();

    // El agente pertenece a esta cuenta (barrera anti cross-tenant).
    const { data: agent, error: agentErr } = await supabase
      .from("ai_agents")
      .select("id")
      .eq("id", id)
      .eq("account_id", accountId)
      .single();
    if (agentErr || !agent) {
      return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
    }

    const [{ data: sources }, { data: access }, { data: qa }] = await Promise.all([
      supabase
        .from("ai_knowledge_sources")
        .select("id, title, status, created_at, updated_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
      supabase.from("ai_agent_source_access").select("source_id").eq("agent_id", id),
      supabase
        .from("ai_qa_pairs")
        .select("id, question, answer, created_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
    ]);

    const enabledIds = new Set((access ?? []).map((r) => r.source_id));
    const sourceList = ((sources ?? []) as { id: string; title: string; status: string; created_at: string; updated_at: string }[]).map(
      (s) => ({ ...s, enabled: enabledIds.has(s.id) }),
    );

    return NextResponse.json({
      sources: sourceList,
      qa: qa ?? [],
      enabledCount: sourceList.filter((s) => s.enabled).length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/ai-agents/:id/knowledge
 * Crea una fuente compartida (texto). Admin+: lo impone RLS y lo
 * valida aquí también para dar el 403 limpio antes del insert.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { supabase, accountId, userId, role } = await getCurrentAccount();
    if (!(role === "owner" || role === "admin")) {
      return NextResponse.json(
        { error: "Solo un admin puede añadir fuentes de conocimiento" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) : "";
    const content = typeof body?.content === "string" ? body.content.trim().slice(0, 100000) : "";
    if (!title || !content) {
      return NextResponse.json(
        { error: "Título y contenido son obligatorios" },
        { status: 400 },
      );
    }

    // Verificar dueño del agente (anti cross-tenant) + crear activada.
    const { data: agent, error: agentErr } = await supabase
      .from("ai_agents")
      .select("id")
      .eq("id", id)
      .eq("account_id", accountId)
      .single();
    if (agentErr || !agent) {
      return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
    }

    const { data: source, error } = await supabase
      .from("ai_knowledge_sources")
      .insert({
        account_id: accountId,
        created_by_user_id: userId,
        title,
        content,
      })
      .select()
      .single();
    if (error || !source) throw error ?? new Error("insert failed");

    // Callbell crea la fuente YA ACTIVADA para el agente que la añade.
    await supabase
      .from("ai_agent_source_access")
      .upsert({ agent_id: id, source_id: source.id });

    return NextResponse.json({ source });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/ai-agents/:id/knowledge
 body: { source_id, enabled } — el toggle "activa" por agente.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { supabase, accountId, role } = await getCurrentAccount();
    if (!(role === "owner" || role === "admin")) {
      return NextResponse.json(
        { error: "Solo un admin puede activar o desactivar fuentes" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => null);
    const sourceId = typeof body?.source_id === "string" ? body.source_id : "";
    if (!sourceId) {
      return NextResponse.json({ error: "source_id es obligatorio" }, { status: 400 });
    }
    // La fuente existe en esta cuenta (cross-tenant check).
    const { data: source, error: srcErr } = await supabase
      .from("ai_knowledge_sources")
      .select("id")
      .eq("id", sourceId)
      .eq("account_id", accountId)
      .single();
    if (srcErr || !source) {
      return NextResponse.json({ error: "Fuente no encontrada" }, { status: 404 });
    }

    if (body.enabled === true) {
      const { error } = await supabase
        .from("ai_agent_source_access")
        .upsert({ agent_id: id, source_id: sourceId });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("ai_agent_source_access")
        .delete()
        .eq("agent_id", id)
        .eq("source_id", sourceId);
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/ai-agents/:id/knowledge?source_id=
 body: borra la fuente COMPLETAMENTE (compartida por cuenta).
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { supabase, accountId, role } = await getCurrentAccount();
    if (!(role === "owner" || role === "admin")) {
      return NextResponse.json(
        { error: "Solo un admin puede borrar fuentes" },
        { status: 403 },
      );
    }
    void id;
    const sourceId = new URL(request.url).searchParams.get("source_id") ?? "";
    if (!sourceId) {
      return NextResponse.json({ error: "source_id es obligatorio" }, { status: 400 });
    }

    const { error } = await supabase
      .from("ai_knowledge_sources")
      .delete()
      .eq("id", sourceId)
      .eq("account_id", accountId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
