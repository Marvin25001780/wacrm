import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { decrypt } from "@/lib/whatsapp/encryption";
import {
  MailflareError,
  normalizeBaseUrl,
  testConnection,
  type MailflareConfig,
} from "@/lib/email/mailflare";

/**
 * POST /api/email/test  (admin+)
 *
 * Botón "Probar conexión": valida URL + API key SIN guardar y devuelve
 * los buzones e identidades que esa key puede usar (para poblar los
 * selectores del formulario). Si no se envía key, usa la guardada.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("admin");

    const limit = checkRateLimit(`email-test:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const baseUrl = normalizeBaseUrl(
      typeof body.base_url === "string" ? body.base_url : "",
    );
    if (!baseUrl) {
      return NextResponse.json(
        { error: "Ingresa la URL de Mailflare." },
        { status: 400 },
      );
    }
    if (!/^https:\/\//i.test(baseUrl)) {
      return NextResponse.json(
        { error: "La URL debe empezar con https://." },
        { status: 400 },
      );
    }

    const rawKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
    let apiKeyPlain = rawKey;
    if (!apiKeyPlain) {
      const { data: existing } = await supabase
        .from("email_config")
        .select("api_key")
        .eq("account_id", accountId)
        .maybeSingle<{ api_key: string | null }>();
      if (!existing?.api_key) {
        return NextResponse.json(
          { error: "Ingresa la API key de Mailflare." },
          { status: 400 },
        );
      }
      try {
        apiKeyPlain = decrypt(existing.api_key);
      } catch {
        return NextResponse.json(
          { error: "La clave guardada no se pudo descifrar — vuelve a ingresarla." },
          { status: 400 },
        );
      }
    }

    const candidate: MailflareConfig = {
      baseUrl,
      apiKey: apiKeyPlain,
      fromName: null,
      fromAddress: null,
      mailboxId: null,
      signature: null,
    };

    const result = await testConnection(candidate);
    return NextResponse.json({
      ok: true,
      mailboxes: result.mailboxes,
      identities: result.identities,
    });
  } catch (err) {
    if (err instanceof MailflareError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}
