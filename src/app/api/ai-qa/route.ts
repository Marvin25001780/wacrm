import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

/**
 * /api/ai-qa — preguntas y respuestas curadas (compartidas por cuenta).
 * El agente las copia tal cual cuando el cliente las pregunta, en vez
 * de improvisar. Admin+: RLS (como las fuentes).
 *
 * GET  → lista de la cuenta
 * POST { question, answer }
 * PATCH{ id, question?, answer? }
 * DELETE ?id=
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from("ai_qa_pairs")
      .select("id, question, answer, created_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ qa: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId, role } = await getCurrentAccount();
    if (!(role === "owner" || role === "admin")) {
      return NextResponse.json(
        { error: "Solo un admin puede añadir preguntas y respuestas" },
        { status: 403 },
      );
    }
    const body = await request.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.trim().slice(0, 500) : "";
    const answer = typeof body?.answer === "string" ? body.answer.trim().slice(0, 5000) : "";
    if (!question || !answer) {
      return NextResponse.json(
        { error: "Pregunta y respuesta son obligatorias" },
        { status: 400 },
      );
    }
    const { data, error } = await supabase
      .from("ai_qa_pairs")
      .insert({ account_id: accountId, created_by_user_id: userId, question, answer })
      .select()
      .single();
    if (error || !data) throw error ?? new Error("insert failed");
    return NextResponse.json({ qa: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount();
    if (!(role === "owner" || role === "admin")) {
      return NextResponse.json(
        { error: "Solo un admin puede editar preguntas y respuestas" },
        { status: 403 },
      );
    }
    const body = await request.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ error: "id es obligatorio" }, { status: 400 });
    }
    const update: Record<string, unknown> = {};
    if (typeof body?.question === "string" && body.question.trim()) {
      update.question = body.question.trim().slice(0, 500);
    }
    if (typeof body?.answer === "string" && body.answer.trim()) {
      update.answer = body.answer.trim().slice(0, 5000);
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("ai_qa_pairs")
      .update(update)
      .eq("id", id)
      .eq("account_id", accountId)
      .select()
      .single();
    if (error || !data) throw error ?? new Error("update failed");
    return NextResponse.json({ qa: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount();
    if (!(role === "owner" || role === "admin")) {
      return NextResponse.json(
        { error: "Solo un admin puede borrar preguntas y respuestas" },
        { status: 403 },
      );
    }
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) {
      return NextResponse.json({ error: "id es obligatorio" }, { status: 400 });
    }
    const { error } = await supabase
      .from("ai_qa_pairs")
      .delete()
      .eq("id", id)
      .eq("account_id", accountId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
