import { NextResponse } from "next/server";

import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { referenceError } from "@/lib/collections/payment-links-shared";
import { publicAnonClient } from "@/lib/supabase/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_STORE = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/**
 * POST /api/public/pagar/[token]/comprobante
 *
 * El deudor reporta una transferencia desde el enlace público. No
 * aprueba nada: deja el comprobante en `pending` para que un admin lo
 * revise. La RPC valida token, monto y referencia; el índice único
 * corta la misma referencia + monto repetida.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  const limited = checkRateLimit(
    `pagar-comprobante:${ip}`,
    RATE_LIMITS.publicPaymentReceipt,
  );
  if (!limited.success) return rateLimitResponse(limited);

  const { token } = await params;
  const cleanToken = (token ?? "").trim();
  if (!cleanToken || cleanToken.length > 128) {
    return jsonError("Este enlace no está disponible.", 404);
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return jsonError("Solicitud inválida.", 400);

  // Honeypot: los bots rellenan un campo que la página deja oculto.
  if (text(body.website, 200)) {
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return jsonError("El monto debe ser mayor que cero.", 400);
  }
  if (amount > 1_000_000) {
    return jsonError("El monto es demasiado alto. Verifícalo.", 400);
  }

  const reference = text(body.reference, 80) ?? "";
  const refError = referenceError(reference);
  if (refError) return jsonError(refError, 400);

  const paidAt = text(body.paid_at, 10);
  if (paidAt && !DATE_RE.test(paidAt)) {
    return jsonError("La fecha del pago no es válida.", 400);
  }

  try {
    const supabase = publicAnonClient();
    const { data, error } = await supabase.rpc("collection_receipt_submit", {
      p_token: cleanToken,
      p_amount: Math.round(amount * 100) / 100,
      p_paid_at: paidAt ?? null,
      p_reference: reference,
      p_bank: text(body.bank, 80),
      p_file_url: text(body.file_url, 500),
      p_mime_type: text(body.mime_type, 100),
      p_notes: text(body.notes, 1000),
    });

    if (error) {
      console.error("[pagar] receipt rpc:", error.code, error.message);
      if (error.code === "23505") {
        return jsonError(
          "Ya existe un comprobante con esa referencia y monto.",
          409,
        );
      }
      if (error.code === "22023") {
        return jsonError(error.message, 400);
      }
      if (error.code === "42P01" || error.code === "PGRST205") {
        return jsonError(
          "El enlace de pago todavía no está habilitado. Contacta a tu asesor.",
          503,
        );
      }
      return jsonError("No se pudo registrar el comprobante.", 500);
    }

    const payload = (data ?? {}) as { ok?: boolean; reason?: string };
    if (!payload.ok) {
      return jsonError(
        payload.reason === "expired"
          ? "Este enlace venció. Pide uno nuevo a tu asesor."
          : "Este enlace ya no está disponible.",
        410,
      );
    }

    return NextResponse.json(data, { headers: NO_STORE });
  } catch (err) {
    console.error("[pagar] unexpected receipt error:", err);
    return jsonError("No se pudo registrar el comprobante.", 500);
  }
}
