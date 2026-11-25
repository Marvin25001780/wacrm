import type {
  CollectionNormalizedRow,
  ImportColumnMapping,
  ImportPreview,
  ImportPreviewRow,
  ParsedSheet,
} from "@/types/collections";
import { normalizeImportRow, parseDateValue } from "./normalize";

/**
 * Valores de la fila de ejemplo que trae la plantilla descargable
 * (ver `TEMPLATE_EXAMPLE` en columns.ts). Si el archivo la sube tal
 * cual, se avisa antes de crear un deudor ficticio.
 */
const SAMPLE_DOCUMENT = "V-12345678";
const SAMPLE_FOLIO = "CR-001";

function cellText(value: unknown): string {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

/**
 * Deduce el número de cuota cuando la columna viene vacía: se numera
 * cada folio por orden de vencimiento (1, 2, 3…). Solo se hace cuando
 * *todas* las filas del folio están vacías y sus fechas son distintas;
 * si el archivo mezcla filas numeradas o repite fechas no se adivina y
 * se deja el error para que se corrija a mano.
 */
function inferInstallmentNumbers(
  rows: Record<string, unknown>[],
  mapping: ImportColumnMapping,
): Map<number, number> {
  const inferred = new Map<number, number>();
  if (!mapping.folio) return inferred;

  const groups = new Map<string, number[]>();
  rows.forEach((raw, index) => {
    const folio = cellText(raw[mapping.folio as string]);
    if (!folio) return;
    const group = groups.get(folio);
    if (group) group.push(index);
    else groups.set(folio, [index]);
  });

  for (const indexes of groups.values()) {
    const allEmpty = indexes.every((index) => {
      const header = mapping.installment_number;
      return cellText(header ? rows[index][header] : "") === "";
    });
    if (!allEmpty) continue;

    const dates = indexes.map((index) =>
      parseDateValue(mapping.due_date ? rows[index][mapping.due_date] : undefined),
    );
    if (dates.some((date) => date == null)) continue;
    if (new Set(dates).size !== dates.length) continue;

    const sorted = indexes
      .map((index, position) => ({ index, due: dates[position] as string }))
      .sort((a, b) => {
        if (a.due === b.due) return a.index - b.index;
        return a.due < b.due ? -1 : 1;
      });

    sorted.forEach((item, position) => {
      inferred.set(item.index, position + 1);
    });
  }

  return inferred;
}

export function buildImportPreview(
  sheet: ParsedSheet,
  mapping: ImportColumnMapping,
  country: "VE" | "US" | "MX" | "CO" | "CL" | "AR" = "VE",
): ImportPreview {
  const rows: ImportPreviewRow[] = [];
  const seen = new Set<string>();
  const inferredNumbers = inferInstallmentNumbers(sheet.rows, mapping);

  let valid = 0;
  let warning = 0;
  let error = 0;

  sheet.rows.forEach((raw, index) => {
    const inferred = inferredNumbers.get(index);
    const result = normalizeImportRow(raw, mapping, country, {
      installment_number: inferred,
    });
    const errors = [...result.errors];
    const warnings = [...result.warnings];

    if (inferred != null) {
      warnings.push(
        `Cuota ${inferred} asignada automáticamente por orden de vencimiento del folio.`,
      );
    }

    if (result.normalized) {
      const key = rowKey(result.normalized);
      if (seen.has(key)) {
        errors.push("Fila duplicada dentro del archivo (mismo documento, folio y cuota).");
      } else {
        seen.add(key);
      }

      if (
        result.normalized.document_number === SAMPLE_DOCUMENT &&
        result.normalized.folio === SAMPLE_FOLIO
      ) {
        warnings.push(
          "Esta fila parece el ejemplo de la plantilla (Juan Pérez / CR-001); bórrala si no es un deudor real.",
        );
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
