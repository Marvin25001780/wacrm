interface CsvOptions {
  /**
   * Separador de columnas. Por defecto `,`.
   * Excel en español espera `;` para abrir el archivo en columnas.
   */
  delimiter?: string
  /**
   * Añade el BOM UTF-8 al inicio. Sin él, Excel en Windows muestra
   * mal los acentos (Teléfono → TelÃ©fono).
   */
  bom?: boolean
}

export function exportToCsv(
  filename: string,
  headers: string[],
  rows: string[][],
  options: CsvOptions = {},
) {
  const delimiter = options.delimiter ?? ','

  const escapeCell = (cell: unknown) => {
    const str = String(cell ?? '')
    if (
      str.includes(delimiter) ||
      str.includes('"') ||
      str.includes('\n') ||
      str.includes('\r')
    ) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const csvContent = [
    headers.map(escapeCell).join(delimiter),
    ...rows.map((row) => row.map(escapeCell).join(delimiter)),
  ].join('\r\n')

  const content = options.bom ? `\uFEFF${csvContent}` : csvContent

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
