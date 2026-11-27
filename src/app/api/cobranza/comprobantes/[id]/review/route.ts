import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/**
 * POST /api/cobranza/comprobantes/[id]/review
 *
 * Aprueba o rechaza un comprobante. Aprobar aplica el pago a las cuotas
 * abiertas del deudor (de la más antigua a la más nueva) usando los
 * triggers de la cartera; o todo a una cuota concreta si se indica.
 * Solo admin/owner.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limited = checkRateLimit(
      `comprobante-review:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limited.success) return rateLimitResponse(limited);

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: "Falta el comprobante." },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      decision?: unknown;
      installment_id?: unknown;
      notes?: unknown;
    };

    const decision =
      body.decision === "approve" || body.decision === "reject"
        ? body.decision
        : null;
    if (!decision) {
      return NextResponse.json(
        { error: "Indica si el comprobante se aprueba o se rechaza." },
        { status: 400 },
      );
    }

    const installmentId =
      typeof body.installment_id === "string" && body.installment_id.trim()
        ? body.installment_id.trim()
        : null;
    const notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim().slice(0, 2000)
        : null;

    const { data, error } = await ctx.supabase.rpc("collection_receipt_review", {
      p_receipt_id: id,
      p_decision: decision,
      p_installment_id: installmentId,
      p_notes: notes,
    });

    if (error) {
      console.error("[comprobantes/review]", error.code, error.message);
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "42501") {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.code === "42P01" || error.code === "PGRST205") {
        return NextResponse.json(
          {
            error:
              "Falta aplicar la migración 135. Ejecuta PROD_UPDATE_135.sql en Supabase.",
          },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ receipt: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
