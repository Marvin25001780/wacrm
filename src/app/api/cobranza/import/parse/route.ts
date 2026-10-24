import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { autoMapColumns } from "@/lib/collections/import/columns";
import { fileTypeFromName, parseCollectionFile } from "@/lib/collections/import/parse";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const form = await request.formData();

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Adjunta un archivo .xlsx o .csv." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "El archivo está vacío." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "El archivo supera el límite de 10 MB." },
        { status: 400 },
      );
    }

    const fileType = fileTypeFromName(file.name);
    const sheet = await parseCollectionFile(file.name, await file.arrayBuffer());
    if (sheet.rows.length === 0) {
      return NextResponse.json(
        { error: "El archivo no contiene filas de datos." },
        { status: 400 },
      );
    }

    const mapping = autoMapColumns(sheet.headers);
    const requestedPortfolioId = String(form.get("portfolioId") ?? "").trim();
    const requestedName = String(form.get("portfolioName") ?? "").trim();

    let portfolioId = requestedPortfolioId || null;

    if (portfolioId) {
      const { data } = await ctx.supabase
        .from("collection_portfolios")
        .select("id")
        .eq("id", portfolioId)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (!data) {
        return NextResponse.json({ error: "La cartera indicada no existe." }, { status: 404 });
      }
    } else {
      const name =
        requestedName ||
        `Cartera ${new Intl.DateTimeFormat("es-VE", {
          dateStyle: "medium",
          timeZone: "America/Caracas",
        }).format(new Date())}`;

      const { data, error } = await ctx.supabase
        .from("collection_portfolios")
        .insert({
          account_id: ctx.accountId,
          name,
          source: fileType,
          created_by: ctx.userId,
        })
        .select("id")
        .single();

      if (error) throw error;
      portfolioId = data.id;
    }

    const { data: batch, error: batchError } = await ctx.supabase
      .from("collection_import_batches")
      .insert({
        account_id: ctx.accountId,
        portfolio_id: portfolioId,
        file_name: file.name,
        file_type: fileType,
        file_size: file.size,
        status: "mapping",
        mapping,
        created_by: ctx.userId,
      })
      .select("id")
      .single();

    if (batchError) throw batchError;

    const chunkSize = 500;
    for (let index = 0; index < sheet.rows.length; index += chunkSize) {
      const chunk = sheet.rows.slice(index, index + chunkSize).map((raw, offset) => ({
        batch_id: batch.id,
        account_id: ctx.accountId,
        row_number: index + offset + 2,
        raw,
      }));

      const { error } = await ctx.supabase.from("collection_import_rows").insert(chunk);
      if (error) throw error;
    }

    return NextResponse.json({
      batchId: batch.id,
      portfolioId,
      headers: sheet.headers,
      mapping,
      rowCount: sheet.rows.length,
      sample: sheet.rows.slice(0, 25),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Formato no soportado")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return toErrorResponse(error);
  }
}
