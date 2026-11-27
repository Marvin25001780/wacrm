import { NextResponse } from "next/server";

import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { publicAnonClient } from "@/lib/supabase/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

/**
 * GET /api/public/pagar/[token]
 *
 * Consulta pública del enlace de pago. No hay sesión: la RPC
 * `collection_payment_link_public` valida el token y devuelve solo
 * nombre, negocio, saldo, cuotas abiertas e instrucciones. Nunca
 * documento, teléfono ni correo del deudor.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  const limited = checkRateLimit(
    `pagar-link:${ip}`,
    RATE_LIMITS.publicPaymentLink,
  );
  if (!limited.success) return rateLimitResponse(limited);

  const { token } = await params;
  const cleanToken = (token ?? "").trim();
  if (!cleanToken || cleanToken.length > 128) {
    return NextResponse.json(
      { ok: false, reason: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const supabase = publicAnonClient();
    const { data, error } = await supabase.rpc(
      "collection_payment_link_public",
      { p_token: cleanToken },
    );

    if (error) {
      // 42P01/PGRST205 = migración 135 pendiente. Se responde igual que
      // un enlace inválido para no filtrar detalles internos al deudor.
      console.error("[pagar] public link rpc:", error.message);
      return NextResponse.json(
        { ok: false, reason: "not_found" },
        { status: 404, headers: NO_STORE },
      );
    }

    const payload =
      data && typeof data === "object"
        ? (data as { ok?: boolean; reason?: string })
        : { ok: false, reason: "not_found" };

    if (!payload.ok) {
      const reason = payload.reason ?? "not_found";
      const status = reason === "not_found" ? 404 : 410;
      return NextResponse.json(
        { ok: false, reason },
        { status, headers: NO_STORE },
      );
    }

    return NextResponse.json(data, { headers: NO_STORE });
  } catch (err) {
    console.error("[pagar] unexpected error:", err);
    return NextResponse.json(
      { ok: false, reason: "not_found" },
      { status: 500, headers: NO_STORE },
    );
  }
}
