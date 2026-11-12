import { NextResponse } from "next/server";

import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { loadMailflareConfig, sendEmail } from "@/lib/email/mailflare";
import {
  isValidEmail,
  mailflareErrorResponse,
  parseAddressList,
} from "@/lib/email/http";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textWithSignature(text: string, signature: string | null): string {
  if (!signature) return text;
  return `${text.trimEnd()}\n\n--\n${signature}`;
}

function htmlWithSignature(html: string, signature: string | null): string {
  if (!signature) return html;
  const escaped = escapeHtml(signature).replace(/\n/g, "<br/>");
  return `${html}\n<p>--<br/>${escaped}</p>`;
}

/**
 * POST /api/email/send  (agent+)
 *
 * Envía un correo desde el buzón conectado y, opcionalmente, lo enlaza
 * al hilo respondido con `inReplyTo`/`references`. La firma configurada
 * se anexa en el servidor para que no dependa del navegador.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");

    const limit = checkRateLimit(`email-send:${userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const mailConfig = await loadMailflareConfig(supabase, accountId);
    if (!mailConfig) {
      return NextResponse.json(
        { error: "El correo no está configurado.", configured: false },
        { status: 409 },
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const to = parseAddressList(body.to);
    const cc = parseAddressList(body.cc);
    const bcc = parseAddressList(body.bcc);
    const invalid = [...to, ...cc, ...bcc].filter((address) => !isValidEmail(address));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Dirección inválida: ${invalid[0]}` },
        { status: 400 },
      );
    }
    if (to.length === 0) {
      return NextResponse.json(
        { error: "Agrega al menos un destinatario." },
        { status: 400 },
      );
    }
    if (to.length + cc.length + bcc.length > 50) {
      return NextResponse.json(
        { error: "Demasiados destinatarios (máximo 50)." },
        { status: 400 },
      );
    }

    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    if (!subject) {
      return NextResponse.json(
        { error: "El asunto es obligatorio." },
        { status: 400 },
      );
    }

    const text = typeof body.text === "string" ? body.text : "";
    const html = typeof body.html === "string" ? body.html : "";
    if (!text.trim() && !html.trim()) {
      return NextResponse.json(
        { error: "El mensaje está vacío." },
        { status: 400 },
      );
    }

    const signature = mailConfig.signature;
    const result = await sendEmail(mailConfig, {
      to,
      cc,
      bcc,
      subject,
      text: text.trim() ? textWithSignature(text, signature) : undefined,
      html: html.trim() ? htmlWithSignature(html, signature) : undefined,
      inReplyTo:
        typeof body.inReplyTo === "string" ? body.inReplyTo.trim() : null,
      references:
        typeof body.references === "string" ? body.references.trim() : null,
    });

    return NextResponse.json({ success: true, id: result.id ?? null });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return toErrorResponse(err);
    }
    return mailflareErrorResponse(err);
  }
}
