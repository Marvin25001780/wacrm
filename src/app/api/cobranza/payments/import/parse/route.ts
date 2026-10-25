import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { importErrorMessage } from "@/lib/collections/import/errors";
import { autoMapPaymentColumns } from "@/lib/collections/import/payments";
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
    if (!(file instanceof File)) return badRequest("Adjunta un archivo .xlsx o .csv.");
    if (file.size === 0) return badRequest("El archivo está vacío.");
    if (file.size > MAX_FILE_BYTES) return badRequest("El archivo supera el límite de 10 MB.");

    let fileType: "xlsx" | "csv";
    let sheet: ParsedSheet;

    try {
      fileType = fileTypeFromName(file.name);
      sheet = await parseCollectionFile(file.name, await file.arrayBuffer());
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : "No se pudo leer el archivo.";
      return badRequest(message);
    }

    if (sheet.rows.length === 0) return badRequest("El archivo no contiene filas de datos.");
    if (sheet.headers.length === 0) {
      return badRequest("No se encontraron encabezados en la primera fila.");
    }

    const mapping = autoMapPaymentColumns(sheet.headers);

    const { data: batch, error: batchError } = await ctx.supabase
      .from("collection_payment_imports")
      .insert({
        account_id: ctx.accountId,
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

    try {
      const chunkSize = 500;
      for (let index = 0; index < sheet.rows.length; index += chunkSize) {
        const chunk = sheet.rows.slice(index, index + chunkSize).map((raw, offset) => ({
          batch_id: batch.id,
          account_id: ctx.accountId,
          row_number: index + offset + 2,
          raw,
        }));

        const { error } = await ctx.supabase
          .from("collection_payment_import_rows")
          .insert(chunk);
        if (error) throw error;
      }
    } catch (error) {
      await ctx.supabase.from("collection_payment_imports").delete().eq("id", batch.id);
      return badRequest(
        `No se pudo guardar el archivo: ${importErrorMessage(error, "error desconocido")}`,
      );
    }

    return NextResponse.json({
      batchId: batch.id,
      headers: sheet.headers,
      mapping,
      rowCount: sheet.rows.length,
      sample: sheet.rows.slice(0, 25),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
