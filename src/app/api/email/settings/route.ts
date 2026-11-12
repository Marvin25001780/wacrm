import { NextResponse } from "next/server";

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { encrypt, decrypt } from "@/lib/whatsapp/encryption";
import {
  MailflareError,
  normalizeBaseUrl,
  testConnection,
  type EmailConfigRow,
  type MailflareConfig,
} from "@/lib/email/mailflare";

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * GET /api/email/settings
 *
 * Cualquier miembro puede ver si la cuenta tiene correo conectado (la
 * barra lateral y el módulo lo usan para decidir qué pantalla mostrar).
 * La API key nunca sale: sólo se informa `has_key`.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from("email_config")
      .select(
        "base_url, api_key, from_name, from_address, mailbox_id, signature, enabled",
      )
      .eq("account_id", accountId)
      .maybeSingle<EmailConfigRow>();

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        return NextResponse.json({ configured: false });
      }
      console.error("[email/settings GET] fetch error:", error);
      return NextResponse.json(
        { error: "No se pudo cargar la configuración de correo." },
        { status: 500 },
      );
    }

    if (!data) return NextResponse.json({ configured: false });

    return NextResponse.json({
      configured: true,
      enabled: data.enabled,
      has_key: Boolean(data.api_key),
      base_url: data.base_url,
      from_name: data.from_name ?? "",
      from_address: data.from_address ?? "",
      mailbox_id: data.mailbox_id ?? "",
      signature: data.signature ?? "",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/email/settings  (admin+)
 *
 * Guarda la conexión. Antes de persistir prueba la URL y la key contra
 * Mailflare (sesión JMAP + buzones), igual que WhatsApp valida con Meta.
 * Si el formulario no reenvía la key, se reutiliza (y descifra) la
 * guardada; nunca se vuelve a mostrar en pantalla.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("admin");

    const limit = checkRateLimit(`email-settings:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return bad("Invalid request body");

    const rawBaseUrl = typeof body.base_url === "string" ? body.base_url.trim() : "";
    if (!rawBaseUrl) return bad("La URL de Mailflare es obligatoria.");
    const baseUrl = normalizeBaseUrl(rawBaseUrl);
    if (!/^https:\/\//i.test(baseUrl)) {
      return bad("La URL de Mailflare debe empezar con https://.");
    }

    const fromName =
      typeof body.from_name === "string" ? body.from_name.trim() || null : null;
    const fromAddress =
      typeof body.from_address === "string"
        ? body.from_address.trim() || null
        : null;
    if (fromAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
      return bad("La dirección de envío no es válida.");
    }
    const mailboxId =
      typeof body.mailbox_id === "string" ? body.mailbox_id.trim() || null : null;
    const signature =
      typeof body.signature === "string" ? body.signature.trim() || null : null;
    const enabled = body.enabled !== false;

    const rawKey = typeof body.api_key === "string" ? body.api_key.trim() : "";

    const { data: existing } = await supabase
      .from("email_config")
      .select("api_key")
      .eq("account_id", accountId)
      .maybeSingle<{ api_key: string | null }>();

    let apiKeyPlain: string;
    if (rawKey) {
      apiKeyPlain = rawKey;
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key);
      } catch {
        return bad(
          "La clave guardada no se pudo descifrar — vuelve a ingresarla.",
        );
      }
    } else {
      return bad("La API key de Mailflare es obligatoria.");
    }

    // Validar contra el servidor real antes de guardar. Un error de red o
    // de permisos se devuelve tal cual para que el admin lo corrija.
    const candidate: MailflareConfig = {
      baseUrl,
      apiKey: apiKeyPlain,
      fromName,
      fromAddress,
      mailboxId,
      signature,
    };
    try {
      await testConnection(candidate);
    } catch (err) {
      if (err instanceof MailflareError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    const row = {
      account_id: accountId,
      base_url: baseUrl,
      from_name: fromName,
      from_address: fromAddress,
      mailbox_id: mailboxId,
      signature,
      enabled,
      ...(rawKey ? { api_key: encrypt(rawKey) } : {}),
    };

    if (existing) {
      const { error } = await supabase
        .from("email_config")
        .update(row)
        .eq("account_id", accountId);
      if (error) {
        console.error("[email/settings POST] update error:", error);
        return NextResponse.json(
          { error: "No se pudo guardar la configuración de correo." },
          { status: 500 },
        );
      }
    } else {
      const { error } = await supabase.from("email_config").insert({
        ...row,
        api_key: encrypt(apiKeyPlain),
        created_by: userId,
      });
      if (error) {
        console.error("[email/settings POST] insert error:", error);
        return NextResponse.json(
          { error: "No se pudo guardar la configuración de correo." },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/email/settings (admin+): olvida la conexión y la key. */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole("admin");
    const { error } = await supabase
      .from("email_config")
      .delete()
      .eq("account_id", accountId);
    if (error) {
      console.error("[email/settings DELETE] error:", error);
      return NextResponse.json(
        { error: "No se pudo desconectar el correo." },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
