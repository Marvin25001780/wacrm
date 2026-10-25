import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { autoMapColumns } from "@/lib/collections/import/columns";
import { importErrorMessage } from "@/lib/collections/import/errors";
import { fileTypeFromName, parseCollectionFile } from "@/lib/collections/import/parse";
import type { ParsedSheet } from "@/types/collections";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const form = await request.formData();

    const file = form.get("file");
    if (!(file instanceof File)) {
      return badRequest("Adjunta un archivo .xlsx o .csv.");
    }
    if (file.size === 0) {
      return badRequest("El archivo está vacío.");
    }
    if (file.size > MAX_FILE_BYTES) {
      return badRequest("El archivo supera el límite de 10 MB.");
    }

    let fileType: "xlsx" | "csv";
    let sheet: ParsedSheet;

    try {
      fileType = fileTypeFromName(file.name);
      sheet = await parseCollectionFile(file.name, await file.arrayBuffer());
    } catch (parseError) {
      // Errores del archivo (formato, codificación, límites) son del
      // usuario, no del servidor: se devuelven como 400 con el motivo.
      const message =
        parseError instanceof Error ? parseError.message : "No se pudo leer el archivo.";
      return badRequest(message);
    }

    if (sheet.rows.length === 0) {
      return badRequest("El archivo no contiene filas de datos.");
    }
    if (sheet.headers.length === 0) {
      return badRequest("No se encontraron encabezados en la primera fila.");
    }

    const mapping = autoMapColumns(sheet.headers);
    const requestedPortfolioId = String(form.get("portfolioId") ?? "").trim();
    const requestedName = String(form.get("portfolioName") ?? "").trim();

    let portfolioId = requestedPortfolioId || null;
    let createdPortfolio = false;

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

      if (error) {
        return NextResponse.json(
          { error: `No se pudo crear la cartera: ${importErrorMessage(error, "error desconocido")}` },
          { status: 400 },
        );
      }
      portfolioId = data.id;
      createdPortfolio = true;
    }

    try {
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
      // Si el lote no llegó a guardarse, no dejamos una cartera vacía.
      if (createdPortfolio && portfolioId) {
        await ctx.supabase.from("collection_portfolios").delete().eq("id", portfolioId);
      }
      return NextResponse.json(
        { error: `No se pudo guardar el archivo: ${importErrorMessage(error, "error desconocido")}` },
        { status: 400 },
      );
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
