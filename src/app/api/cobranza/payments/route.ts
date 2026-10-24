import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

interface PaymentInput {
  installment_id?: string;
  amount?: number;
  paid_at?: string;
  method?: string;
  reference?: string;
  notes?: string;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json().catch(() => ({}))) as {
      payments?: PaymentInput[];
    };

    const payments = Array.isArray(body.payments) ? body.payments : [];
    if (payments.length === 0) {
      return NextResponse.json({ error: "Agrega al menos un pago." }, { status: 400 });
    }

    const ids = [...new Set(payments.map((p) => p.installment_id).filter(Boolean))] as string[];
    if (ids.length !== payments.length) {
      return NextResponse.json({ error: "Cada pago debe indicar una cuota." }, { status: 400 });
    }

    const { data: installments, error: fetchError } = await ctx.supabase
      .from("collection_installments")
      .select("id, credit_id, debtor_id, total, paid_amount, status")
      .in("id", ids)
      .eq("account_id", ctx.accountId);

    if (fetchError) throw fetchError;

    const byId = new Map(
      (installments ?? []).map((row) => [row.id as string, row]),
    );

    const rows = payments.map((payment) => {
      const installment = byId.get(payment.installment_id!);
      if (!installment) {
        throw new Error("Una de las cuotas no existe en esta cuenta.");
      }
      if (installment.status === "cancelled") {
        throw new Error("No se puede abonar a una cuota anulada.");
      }

      const amount = Number(payment.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Cada pago debe tener un monto mayor que cero.");
      }

      const balance = Math.max(
        0,
        Number(installment.total) - Number(installment.paid_amount),
      );
      if (amount > balance + 0.005) {
        throw new Error(`El pago excede el saldo de la cuota (${balance.toFixed(2)}).`);
      }

      return {
        account_id: ctx.accountId,
        installment_id: payment.installment_id!,
        credit_id: installment.credit_id as string,
        debtor_id: installment.debtor_id as string,
        amount,
        ...(payment.paid_at ? { paid_at: payment.paid_at } : {}),
        method: payment.method || null,
        reference: payment.reference || null,
        notes: payment.notes || null,
        source: "manual" as const,
        created_by: ctx.userId,
      };
    });

    const { data, error } = await ctx.supabase
      .from("collection_payments")
      .insert(rows)
      .select("id, installment_id, amount, paid_at");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ payments: data });
  } catch (error) {
    if (error instanceof Error && !error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return toErrorResponse(error);
  }
}
