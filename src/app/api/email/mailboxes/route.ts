import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/auth/account";
import {
  listIdentities,
  listMailboxes,
  loadMailflareConfig,
} from "@/lib/email/mailflare";
import { mailflareErrorResponse } from "@/lib/email/http";

/**
 * GET /api/email/mailboxes
 *
 * Buzones e identidades de envío disponibles para la API key. Lo usa el
 * módulo Correo para el filtro por buzón y el compositor (remitente).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const config = await loadMailflareConfig(supabase, accountId);
    if (!config) {
      return NextResponse.json(
        { error: "El correo no está configurado.", configured: false },
        { status: 409 },
      );
    }

    const [mailboxes, identities] = await Promise.all([
      listMailboxes(config),
      listIdentities(config),
    ]);

    return NextResponse.json({
      mailboxes,
      identities,
      default_mailbox_id: config.mailboxId,
      default_from:
        config.fromAddress || identities[0]?.email || null,
    });
  } catch (err) {
    return mailflareErrorResponse(err);
  }
}
