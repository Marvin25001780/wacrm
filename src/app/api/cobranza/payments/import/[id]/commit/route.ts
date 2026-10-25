import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { CollectionPaymentNormalizedRow } from "@/types/collections";

export const runtime = "nodejs";

interface PaymentRow {
  id: string;
  row_number: number;
  normalized: CollectionPaymentNormalizedRow | null;
  status: string;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const { data: batch, error: batchError } = await ctx.supabase
      .from("collection_payment_imports")
      .select("id, status")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (batchError) throw batchError;
    if (!batch) return NextResponse.json({ error: "Lote no encontrado." }, { status: 404 });
    if (batch.status !== "validated") {
      return NextResponse.json(
        { error: "El lote debe estar validado antes de confirmar." },
        { status: 400 },
      );
    }

    const { data: rows, error: rowsError } = await ctx.supabase
      .from("collection_payment_import_rows")
      .select("id, row_number, normalized, status")
      .eq("batch_id", id)
      .in("status", ["valid", "warning"])
      .order("row_number", { ascending: true });

    if (rowsError) throw rowsError;

    const pending = (rows ?? []) as PaymentRow[];
    let created = 0;
    let totalAmount = 0;
    let errors = 0;

    for (const row of pending) {
      const normalized = row.normalized;
      if (!normalized?.installment_id) {
        errors += 1;
        await ctx.supabase
          .from("collection_payment_import_rows")
          .update({ status: "error", errors: ["La fila no tiene una cuota resuelta."] })
          .eq("id", row.id);
        continue;
      }

      // Secuencial a propósito: el trigger de la cuota suma los pagos
      // existentes y dos inserciones concurrentes podrían pasar ambas
      // el control de saldo.
      const { data: payment, error: insertError } = await ctx.supabase
        .from("collection_payments")
        .insert({
          account_id: ctx.accountId,
          installment_id: normalized.installment_id,
          credit_id: normalized.credit_id,
          debtor_id: normalized.debtor_id,
          amount: normalized.amount,
          paid_at: normalized.paid_at,
          method: normalized.method ?? null,
          reference: normalized.reference ?? null,
          source: "import",
          notes: normalized.notes ?? null,
          created_by: ctx.userId,
        })
        .select("id")
        .single();

      if (insertError) {
        errors += 1;
        await ctx.supabase
          .from("collection_payment_import_rows")
          .update({ status: "error", errors: [insertError.message] })
          .eq("id", row.id);
        continue;
      }

      created += 1;
      totalAmount += Number(normalized.amount ?? 0);

      await ctx.supabase
        .from("collection_payment_import_rows")
        .update({ status: "imported", payment_id: payment?.id ?? null, errors: null })
        .eq("id", row.id);
    }

    const summary = {
      created_payments: created,
      total_amount: Number(totalAmount.toFixed(2)),
      errors,
      committed_rows: created,
      total_rows: pending.length,
    };

    const { error: updateBatchError } = await ctx.supabase
      .from("collection_payment_imports")
      .update({ status: "committed", committed_at: new Date().toISOString(), summary })
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (updateBatchError) throw updateBatchError;

    await ctx.supabase.rpc("collection_recompute_priorities", {
      p_account_id: ctx.accountId,
    });

    return NextResponse.json({ summary });
  } catch (error) {
    return toErrorResponse(error);
  }
}
