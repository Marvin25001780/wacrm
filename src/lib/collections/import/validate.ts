import type {
  CollectionNormalizedRow,
  ImportColumnMapping,
  ImportPreview,
  ImportPreviewRow,
  ParsedSheet,
} from "@/types/collections";
import { normalizeImportRow } from "./normalize";

export function buildImportPreview(
  sheet: ParsedSheet,
  mapping: ImportColumnMapping,
  country: "VE" | "US" | "MX" | "CO" | "CL" | "AR" = "VE",
): ImportPreview {
  const rows: ImportPreviewRow[] = [];
  const seen = new Set<string>();

  let valid = 0;
  let warning = 0;
  let error = 0;

  sheet.rows.forEach((raw, index) => {
    const result = normalizeImportRow(raw, mapping, country);
    const errors = [...result.errors];
    const warnings = [...result.warnings];

    if (result.normalized) {
      const key = rowKey(result.normalized);
      if (seen.has(key)) {
        errors.push("Fila duplicada dentro del archivo (mismo documento, folio y cuota).");
      } else {
        seen.add(key);
      }
    }

    const status: ImportPreviewRow["status"] =
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid";

    if (status === "valid") valid += 1;
    else if (status === "warning") warning += 1;
    else error += 1;

    rows.push({
      rowNumber: index + 2,
      raw,
      normalized: errors.length > 0 ? null : result.normalized,
      status,
      errors,
      warnings,
    });
  });

  return {
    headers: sheet.headers,
    mapping,
    rows,
    summary: {
      total: rows.length,
      valid,
      warning,
      error,
    },
  };
}

function rowKey(row: CollectionNormalizedRow): string {
  return [
    row.document_number ?? row.name,
    row.phone_primary ?? "",
    row.folio,
    row.installment_number,
  ].join("|");
}
