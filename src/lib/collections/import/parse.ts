import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";

import type { ParsedSheet } from "@/types/collections";

const MAX_ROWS = 20_000;
const MAX_COLUMNS = 200;

interface ExcelCellObject {
  richText?: { text: string }[];
  formula?: string;
  sharedFormula?: string;
  result?: unknown;
  text?: string;
  hyperlink?: string;
  error?: string;
}

/**
 * PostgreSQL (JSONB) rechaza el carácter NUL y los controles raros
 * que a veces deja Excel al guardar. Los limpiamos antes de persistir.
 */
function sanitize(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g, "").trim();
}

function cellToValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value as unknown;
  if (value == null) return "";

  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (typeof value === "object") {
    const object = value as ExcelCellObject;
    if (object.richText) return sanitize(object.richText.map((part) => part.text).join(""));
    if (object.formula != null || object.sharedFormula != null) {
      const result = object.result;
      if (result == null) return "";
      if (result instanceof Date) {
        const year = result.getUTCFullYear();
        const month = String(result.getUTCMonth() + 1).padStart(2, "0");
        const day = String(result.getUTCDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      }
      return typeof result === "object" ? "" : result;
    }
    if (object.text != null) return sanitize(String(object.text));
    if (object.error != null) return "";
    if (object.result != null) return object.result as string | number;
  }

  if (typeof value === "string") return sanitize(value);
  if (typeof value === "bigint") return Number(value);
  return value;
}

function dedupeHeaders(values: unknown[]): string[] {
  const seen = new Map<string, number>();

  return values.map((value, index) => {
    const base = sanitize(String(value ?? "")) || `Columna ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

async function parseExcel(buffer: ArrayBuffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer as never);
  } catch {
    throw new Error(
      "No se pudo leer el Excel. Ábrelo y guárdalo como .xlsx o .csv, y vuelve a intentarlo.",
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("El archivo no contiene hojas.");

  const columnCount = Math.min(Math.max(worksheet.columnCount, 1), MAX_COLUMNS);
  const rowCount = Math.max(worksheet.rowCount, worksheet.actualRowCount ?? 0, 1);
  let headerRowNumber = 1;

  for (let rowNumber = 1; rowNumber <= Math.min(rowCount, 10); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let nonEmpty = 0;
    for (let column = 1; column <= columnCount; column += 1) {
      if (String(cellToValue(row.getCell(column)) ?? "").trim() !== "") nonEmpty += 1;
    }
    if (nonEmpty >= 2) {
      headerRowNumber = rowNumber;
      break;
    }
  }

  const headerRow = worksheet.getRow(headerRowNumber);
  const headers = dedupeHeaders(
    Array.from({ length: columnCount }, (_, index) => cellToValue(headerRow.getCell(index + 1))),
  );

  const rows: Record<string, unknown>[] = [];

  for (let rowNumber = headerRowNumber + 1; rowNumber <= rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const record: Record<string, unknown> = {};
    let hasValue = false;

    for (let column = 1; column <= columnCount; column += 1) {
      const value = cellToValue(row.getCell(column));
      record[headers[column - 1]] = value;
      if (value != null && String(value).trim() !== "") hasValue = true;
    }

    if (hasValue) rows.push(record);
    if (rows.length > MAX_ROWS) {
      throw new Error(`El archivo supera el límite de ${MAX_ROWS} filas.`);
    }
  }

  return { headers, rows };
}

/** Cuenta separadores fuera de comillas para elegir el delimitador. */
function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];
    if (current === '"') {
      if (inQuotes && line[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && current === char) {
      count += 1;
    }
  }

  return count;
}

/**
 * Excel en Windows guarda CSV en la codificación ANSI del sistema
 * (Windows-1252) cuando se elige "CSV (delimitado por comas)". Si la
 * lectura UTF-8 produce caracteres de reemplazo, reintentamos.
 */
function decodeCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return utf8.replace(/^\uFEFF/, "");
  } catch {
    const fallback = new TextDecoder("windows-1252").decode(bytes);
    return fallback.replace(/^\uFEFF/, "");
  }
}

function parseCsvBuffer(buffer: ArrayBuffer): ParsedSheet {
  let text = decodeCsv(buffer);
  if (!text.trim()) throw new Error("El archivo está vacío.");

  // Excel inserta una línea `sep=;` o `sep=,` al principio cuando se
  // exporta con un separador explícito.
  const separatorHint = text.match(/^sep=(.)\r?\n/i);
  if (separatorHint) text = text.slice(separatorHint[0].length);

  const firstLine =
    text
      .split(/\r?\n/)
      .find((line) => line.trim() !== "") ?? "";
  const semicolons = countOutsideQuotes(firstLine, ";");
  const commas = countOutsideQuotes(firstLine, ",");
  const tabs = countOutsideQuotes(firstLine, "\t");
  const delimiter = separatorHint
    ? separatorHint[1]
    : tabs > semicolons && tabs > commas
      ? "\t"
      : semicolons > commas
        ? ";"
        : ",";

  let records: string[][];
  try {
    records = parseCsv(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      delimiter,
    }) as string[][];
  } catch {
    throw new Error(
      "No se pudo leer el CSV. Revisa que no tenga comillas sin cerrar y guárdalo de nuevo.",
    );
  }

  const data = records.filter((record) => record.some((cell) => String(cell ?? "").trim() !== ""));
  if (data.length === 0) throw new Error("El archivo no contiene filas de datos.");

  const headers = dedupeHeaders(data[0].slice(0, MAX_COLUMNS));
  const rows = data.slice(1).map((values) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = sanitize(String(values[index] ?? ""));
    });
    return record;
  });

  if (rows.length > MAX_ROWS) {
    throw new Error(`El archivo supera el límite de ${MAX_ROWS} filas.`);
  }

  return { headers, rows };
}

export function fileTypeFromName(fileName: string): "xlsx" | "csv" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xls")) {
    throw new Error(
      "El formato .xls (Excel 97-2003) no es compatible. Guarda el archivo como .xlsx o .csv.",
    );
  }
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return "csv";
  throw new Error("Formato no soportado. Usa .xlsx o .csv.");
}

export async function parseCollectionFile(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParsedSheet> {
  const type = fileTypeFromName(fileName);
  return type === "xlsx" ? parseExcel(buffer) : parseCsvBuffer(buffer);
}
