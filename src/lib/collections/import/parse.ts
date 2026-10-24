import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";

import type { ParsedSheet } from "@/types/collections";

const MAX_ROWS = 20_000;

interface ExcelCellObject {
  richText?: { text: string }[];
  formula?: string;
  result?: unknown;
  text?: string;
}

function cellToValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value == null) return "";

  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (typeof value === "object") {
    const object = value as ExcelCellObject;
    if (object.richText) return object.richText.map((part) => part.text).join("");
    if (object.formula != null) return object.result ?? "";
    if (object.text != null) return object.text;
    if (object.result != null) return object.result;
  }

  return value;
}

function dedupeHeaders(values: unknown[]): string[] {
  const seen = new Map<string, number>();

  return values.map((value, index) => {
    const base = String(value ?? "").trim() || `Columna ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

async function parseExcel(buffer: ArrayBuffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("El archivo no contiene hojas.");

  const columnCount = Math.max(worksheet.columnCount, 1);
  let headerRowNumber = 1;

  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 10); rowNumber += 1) {
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

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
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

function parseCsvBuffer(buffer: ArrayBuffer): ParsedSheet {
  const text = new TextDecoder("utf-8").decode(buffer);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const delimiter = tabs > semicolons && tabs > commas ? "\t" : semicolons > commas ? ";" : ",";

  const records = parseCsv(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    delimiter,
  }) as string[][];

  if (records.length === 0) throw new Error("El archivo está vacío.");

  const headers = dedupeHeaders(records[0]);
  const rows = records.slice(1).map((values) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
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
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
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
