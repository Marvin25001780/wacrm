import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/auth/account";
import { loadMailflareConfig, markMessageRead } from "@/lib/email/mailflare";
import { mailflareErrorResponse } from "@/lib/email/http";

/**
 * POST /api/email/messages/[id]/read
 *
 * Marca (o desmarca) un correo como leído vía JMAP `Email/set`. Se llama
 * al abrir un mensaje en la bandeja.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Falta el correo." }, { status: 400 });
    }

    const { supabase, accountId } = await getCurrentAccount();
    const config = await loadMailflareConfig(supabase, accountId);
    if (!config) {
      return NextResponse.json(
        { error: "El correo no está configurado.", configured: false },
        { status: 409 },
      );
    }

    const body = await request.json().catch(() => null);
    const read = body?.read !== false;

    await markMessageRead(config, id, read);
    return NextResponse.json({ success: true, read });
  } catch (err) {
    return mailflareErrorResponse(err);
  }
}
