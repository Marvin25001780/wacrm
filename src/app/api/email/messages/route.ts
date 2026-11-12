import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/auth/account";
import { listMessages, loadMailflareConfig } from "@/lib/email/mailflare";
import { mailflareErrorResponse } from "@/lib/email/http";

/**
 * GET /api/email/messages?mailboxId=&direction=&q=&limit=
 *
 * Lista los correos que la API key puede leer. La búsqueda y el filtro
 * los resuelve Mailflare; el CRM sólo presenta la bandeja.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const config = await loadMailflareConfig(supabase, accountId);
    if (!config) {
      return NextResponse.json(
        { error: "El correo no está configurado.", configured: false },
        { status: 409 },
      );
    }

    const url = new URL(request.url);
    const direction = url.searchParams.get("direction");
    const limitRaw = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

    const messages = await listMessages(config, {
      mailboxId: url.searchParams.get("mailboxId"),
      direction:
        direction === "inbound" || direction === "outbound" ? direction : null,
      query: url.searchParams.get("q"),
      limit,
    });

    return NextResponse.json({ messages });
  } catch (err) {
    return mailflareErrorResponse(err);
  }
}
