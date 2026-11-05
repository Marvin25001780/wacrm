// ============================================================
// CSV del POS.
//
// Se usa punto y coma como separador y coma decimal porque es lo
// que Excel abre bien en Venezuela. El parser acepta ambos
// separadores y comillas dobles, así que también sirve para
// archivos exportados desde otros sistemas.
// ============================================================

export type CsvCell = string | number | boolean | null | undefined;

/** Detecta `;` o `,` mirando la cabecera. Prefiere `;`. */
export function detectDelimiter(text: string): ";" | "," {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let semicolons = 0;
  let commas = 0;
  let quoted = false;

  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ";") semicolons += 1;
    else if (!quoted && char === ",") commas += 1;
  }
  return semicolons >= commas ? ";" : ",";
}

/** Parser CSV con comillas, comillas escapadas y saltos CRLF. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const sep = delimiter ?? detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === sep) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((line) => line.some((value) => value.trim() !== ""));
}

/** `Código de barras` → `codigo_de_barras`. */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** `Sí`, `1`, `x`, `true` → true. */
export function parseBool(value: string | undefined, fallback: boolean): boolean {
  const text = normalizeHeader(value ?? "");
  if (!text) return fallback;
  if (["si", "s", "1", "x", "true", "yes", "y"].includes(text)) return true;
  if (["no", "n", "0", "false", "off"].includes(text)) return false;
  return fallback;
}

function escapeCell(value: CsvCell, delimiter: string): string {
  const text = value == null ? "" : String(value);
  const mustQuote =
    text.includes(delimiter) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r");
  return mustQuote ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: CsvCell[][], delimiter = ";"): string {
  return rows
    .map((row) => row.map((cell) => escapeCell(cell, delimiter)).join(delimiter))
    .join("\r\n");
}

/** Descarga un CSV con BOM para que Excel respete los acentos. */
export function downloadCsv(
  filename: string,
  rows: CsvCell[][],
  delimiter = ";",
): void {
  const csv = `\uFEFF${toCsv(rows, delimiter)}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Número con coma decimal y sin separador de miles: `1234,56`. */
export function csvNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(decimals).replace(".", ",");
}

/** Cantidad sin decimales innecesarios: `3` o `1,25`. */
export function csvQuantity(value: number): string {
  const fixed = value.toFixed(3).replace(/\.?0+$/, "");
  return fixed.replace(".", ",");
}

/** Fecha local de Venezuela: `05/11/2026 14:30`. */
export function csvDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-VE", {
    timeZone: "America/Caracas",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
