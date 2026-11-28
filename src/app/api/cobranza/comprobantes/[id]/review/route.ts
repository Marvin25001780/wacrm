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
      amount?: unknown;
      reference?: unknown;
      bank?: unknown;
      paid_at?: unknown;
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

    // Correcciones de la bandeja (136): el OCR puede leer mal el monto
    // o la referencia. Se aplican antes de aprobar, en la misma acción.
    const corrections =
      decision === "approve"
        ? {
            amount:
              body.amount === undefined || body.amount === null
                ? null
                : Number(body.amount),
            reference:
              typeof body.reference === "string" && body.reference.trim()
                ? body.reference.trim()
                : null,
            bank:
              typeof body.bank === "string" && body.bank.trim()
                ? body.bank.trim()
                : null,
            paid_at:
              typeof body.paid_at === "string" && body.paid_at.trim()
                ? body.paid_at.trim()
                : null,
          }
        : null;

    if (
      corrections &&
      (corrections.amount !== null ||
        corrections.reference !== null ||
        corrections.bank !== null ||
        corrections.paid_at !== null)
    ) {
      if (corrections.amount !== null && !Number.isFinite(corrections.amount)) {
        return NextResponse.json(
          { error: "El monto corregido no es un número válido." },
          { status: 400 },
        );
      }

      const { error: updateError } = await ctx.supabase.rpc(
        "collection_receipt_update",
        {
          p_receipt_id: id,
          p_amount: corrections.amount,
          p_paid_at: corrections.paid_at,
          p_reference: corrections.reference,
          p_bank: corrections.bank,
          p_notes: null,
        },
      );

      if (updateError) {
        console.error("[comprobantes/review] update:", updateError.code, updateError.message);
        if (updateError.code === "22023" || updateError.code === "23505") {
          return NextResponse.json({ error: updateError.message }, { status: 400 });
        }
        if (updateError.code === "42501") {
          return NextResponse.json({ error: updateError.message }, { status: 403 });
        }
        if (updateError.code === "P0002") {
          return NextResponse.json({ error: updateError.message }, { status: 404 });
        }
        if (updateError.code === "42P01" || updateError.code === "PGRST205") {
          return NextResponse.json(
            {
              error:
                "Falta aplicar la migración 136. Ejecuta PROD_UPDATE_136.sql en Supabase.",
            },
            { status: 409 },
          );
        }
        throw new Error(updateError.message);
      }
    }

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
