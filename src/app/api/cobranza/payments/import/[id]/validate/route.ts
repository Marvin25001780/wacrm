import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { autoMapPaymentColumns, buildPaymentPreview } from "@/lib/collections/import/payments";
import { loadInstallmentRefs } from "@/lib/collections/import/payment-lookup";
import type { PaymentImportColumnMapping } from "@/types/collections";

export const runtime = "nodejs";

const PAGE_SIZE = 1_000;
const PREVIEW_LIMIT = 300;

interface RowRecord {
  id: string;
  row_number: number;
  raw: Record<string, unknown>;
}

function sanitizeMapping(input: unknown, headers: string[]): PaymentImportColumnMapping {
  const mapping: PaymentImportColumnMapping = {};
  const source =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  for (const [key, value] of Object.entries(source)) {
    mapping[key] = typeof value === "string" && headers.includes(value) ? value : null;
  }

  return mapping;
}

async function fetchRows(
  supabase: Awaited<ReturnType<typeof requireRole>>["supabase"],
  batchId: string,
): Promise<RowRecord[]> {
  const rows: RowRecord[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("collection_payment_import_rows")
      .select("id, row_number, raw")
      .eq("batch_id", batchId)
      .order("row_number", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const page = (data ?? []) as RowRecord[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { mapping?: unknown };

    const { data: batch, error: batchError } = await ctx.supabase
      .from("collection_payment_imports")
      .select("id, status, mapping")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (batchError) throw batchError;
    if (!batch) return NextResponse.json({ error: "Lote no encontrado." }, { status: 404 });
    if (batch.status === "committed") {
      return NextResponse.json(
        { error: "Este lote ya fue confirmado y no se puede revalidar." },
        { status: 400 },
      );
    }

    const rows = await fetchRows(ctx.supabase, id);
    if (rows.length === 0) {
      return NextResponse.json({ error: "El lote no tiene filas." }, { status: 400 });
    }

    const headers = Object.keys(rows[0].raw ?? {});
    const mapping =
      body.mapping && typeof body.mapping === "object"
        ? sanitizeMapping(body.mapping, headers)
        : autoMapPaymentColumns(headers);

    const folioHeader = mapping.folio;
    if (!folioHeader) {
      return NextResponse.json(
        { error: "Falta mapear la columna del folio del crédito." },
        { status: 400 },
      );
    }

    const folios = [
      ...new Set(
        rows
          .map((row) => String(row.raw[folioHeader] ?? "").trim())
          .filter((value) => value !== ""),
      ),
    ];

    const refs = await loadInstallmentRefs(ctx.supabase, ctx.accountId, folios);
    const preview = buildPaymentPreview({ headers, rows: rows.map((row) => row.raw) }, mapping, refs);

    const updates = preview.rows.map((row, index) => ({
      id: rows[index].id,
      batch_id: id,
      account_id: ctx.accountId,
      row_number: row.rowNumber,
      raw: row.raw,
      normalized: row.normalized,
      status: row.status,
      errors: row.errors.length > 0 ? row.errors : null,
      installment_id: row.normalized?.installment_id ?? null,
    }));

    const chunkSize = 500;
    for (let index = 0; index < updates.length; index += chunkSize) {
      const { error } = await ctx.supabase
        .from("collection_payment_import_rows")
        .upsert(updates.slice(index, index + chunkSize), { onConflict: "id" });
      if (error) throw error;
    }

    const summary = {
      ...preview.summary,
      total_amount: preview.rows.reduce(
        (sum, row) => sum + (row.normalized?.amount ?? 0),
        0,
      ),
    };

    const { error: updateBatchError } = await ctx.supabase
      .from("collection_payment_imports")
      .update({ status: "validated", mapping, summary })
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (updateBatchError) throw updateBatchError;

    return NextResponse.json({
      batchId: id,
      summary,
      mapping,
      headers,
      rows: preview.rows.slice(0, PREVIEW_LIMIT),
      truncated: preview.rows.length > PREVIEW_LIMIT,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
