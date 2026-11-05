// ============================================================
// Importación de productos desde CSV.
//
// La cabecera es flexible: acepta los nombres del sistema y sus
// alias en español o inglés. Los números aceptan coma o punto
// decimal. El parseo no toca la base: solo valida y clasifica.
// ============================================================

import { normalizeHeader, parseBool, parseCsv } from "@/lib/pos/csv";
import { toNumber } from "@/lib/pos/money";

export type ImportKind = "product" | "supply" | "service";

export interface ParsedProductRow {
  /** Número de fila del CSV, contando la cabecera como 1. */
  line: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryName: string | null;
  categoryId: string | null;
  unit: string;
  kind: ImportKind;
  cost: number;
  price: number;
  stock: number;
  minStock: number;
  taxable: boolean;
  trackInventory: boolean;
  description: string | null;
  /** Motivo por el que la fila no se puede importar. */
  error: string | null;
}

export interface ParseProductsResult {
  rows: ParsedProductRow[];
  headers: string[];
  missingColumns: string[];
  delimiter: string;
}

export interface ExistingProduct {
  sku: string | null;
  barcode: string | null;
}

const ALIASES: Record<string, string[]> = {
  name: ["nombre", "name", "producto", "articulo", "item"],
  sku: ["sku", "codigo", "codigo_interno", "clave"],
  barcode: ["codigo_barras", "barcode", "ean", "barra", "codigo_de_barra"],
  category: ["categoria", "category", "rubro", "departamento", "linea"],
  unit: ["unidad", "unit", "medida", "unidad_de_medida"],
  kind: ["tipo", "kind", "clase"],
  cost: ["costo", "cost", "costo_usd", "precio_compra", "costo_compra"],
  price: ["precio", "price", "precio_usd", "precio_venta", "pvp", "venta"],
  stock: ["stock", "existencia", "existencias", "cantidad", "inventario"],
  minStock: ["stock_minimo", "min_stock", "minimo", "min", "stock_min"],
  taxable: ["gravable", "taxable", "iva", "lleva_iva"],
  trackInventory: [
    "controla_inventario",
    "track_inventory",
    "control_inventario",
    "inventariable",
  ],
  description: ["descripcion", "description", "detalle", "notas"],
};

/** Cabecera que descarga la plantilla y que el importador entiende. */
export const IMPORT_HEADERS = [
  "nombre",
  "sku",
  "codigo_barras",
  "categoria",
  "unidad",
  "tipo",
  "costo",
  "precio",
  "stock",
  "stock_minimo",
  "gravable",
  "controla_inventario",
  "descripcion",
];

function findColumn(headers: string[], field: string): number {
  const aliases = ALIASES[field] ?? [field];
  return headers.findIndex((header) => aliases.includes(header));
}

function kindOf(value: string): ImportKind {
  const text = normalizeHeader(value);
  if (text.includes("insumo") || text.includes("supply")) return "supply";
  if (text.includes("servicio") || text.includes("service")) return "service";
  return "product";
}

function clean(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

export function parseProductsCsv(
  text: string,
  categories: { id: string; name: string }[],
  existing: ExistingProduct[],
): ParseProductsResult {
  const table = parseCsv(text);
  const headers = (table[0] ?? []).map(normalizeHeader);
  const body = table.slice(1);

  const columns = {
    name: findColumn(headers, "name"),
    sku: findColumn(headers, "sku"),
    barcode: findColumn(headers, "barcode"),
    category: findColumn(headers, "category"),
    unit: findColumn(headers, "unit"),
    kind: findColumn(headers, "kind"),
    cost: findColumn(headers, "cost"),
    price: findColumn(headers, "price"),
    stock: findColumn(headers, "stock"),
    minStock: findColumn(headers, "minStock"),
    taxable: findColumn(headers, "taxable"),
    trackInventory: findColumn(headers, "trackInventory"),
    description: findColumn(headers, "description"),
  };

  const missingColumns: string[] = [];
  if (columns.name < 0) missingColumns.push("nombre");

  const categoryMap = new Map(
    categories.map((category) => [normalizeHeader(category.name), category]),
  );
  const existingSkus = new Set(
    existing
      .map((product) => product.sku?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  const existingBarcodes = new Set(
    existing
      .map((product) => product.barcode?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );

  const fileSkus = new Set<string>();
  const fileBarcodes = new Set<string>();

  const rows = body.map((cells, index): ParsedProductRow => {
    const line = index + 2;
    const get = (column: number) => (column >= 0 ? (cells[column] ?? "") : "");

    const name = get(columns.name).trim();
    const sku = clean(get(columns.sku));
    const barcode = clean(get(columns.barcode));
    const categoryName = clean(get(columns.category));
    const kind = kindOf(get(columns.kind));
    const cost = toNumber(get(columns.cost));
    const price = toNumber(get(columns.price));
    const stock = toNumber(get(columns.stock));
    const minStock = toNumber(get(columns.minStock));
    const taxable = parseBool(get(columns.taxable), true);
    const trackInventory = parseBool(
      get(columns.trackInventory),
      kind !== "service",
    );
    const unit = clean(get(columns.unit)) ?? "unidad";
    const description = clean(get(columns.description));

    const category = categoryName
      ? categoryMap.get(normalizeHeader(categoryName))
      : undefined;

    let error: string | null = null;

    if (name.length < 2) {
      error = "Falta el nombre";
    } else if (kind !== "supply" && price <= 0) {
      error = "Falta el precio de venta";
    } else if (cost < 0) {
      error = "El costo no puede ser negativo";
    } else if (stock < 0) {
      error = "El stock no puede ser negativo";
    } else if (minStock < 0) {
      error = "El stock mínimo no puede ser negativo";
    } else if (sku && (existingSkus.has(sku.toLowerCase()) || fileSkus.has(sku.toLowerCase()))) {
      error = "El SKU ya existe";
    } else if (
      barcode &&
      (existingBarcodes.has(barcode.toLowerCase()) ||
        fileBarcodes.has(barcode.toLowerCase()))
    ) {
      error = "El código de barras ya existe";
    }

    if (!error) {
      if (sku) fileSkus.add(sku.toLowerCase());
      if (barcode) fileBarcodes.add(barcode.toLowerCase());
    }

    return {
      line,
      name,
      sku,
      barcode,
      categoryName,
      categoryId: category?.id ?? null,
      unit,
      kind,
      cost,
      price: kind === "supply" ? 0 : price,
      stock: kind === "service" ? 0 : stock,
      minStock,
      taxable,
      trackInventory: kind === "service" ? false : trackInventory,
      description,
      error,
    };
  });

  return {
    rows,
    headers,
    missingColumns,
    delimiter: detectDelimiterSafe(text),
  };
}

function detectDelimiterSafe(text: string): string {
  // El parser ya lo detectó; se expone solo para mostrarlo en la vista.
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.includes(";") ? ";" : ",";
}

/** Plantilla vacía con dos ejemplos. */
export function templateRows(): string[][] {
  return [
    IMPORT_HEADERS,
    [
      "Café molido 250 g",
      "CAFE-250",
      "7591234567890",
      "Bebidas",
      "unidad",
      "producto",
      "2,50",
      "5,00",
      "12",
      "4",
      "si",
      "si",
      "Bolsa de 250 gramos",
    ],
    [
      "Servicio de instalación",
      "INST-01",
      "",
      "",
      "servicio",
      "servicio",
      "0",
      "15,00",
      "0",
      "0",
      "no",
      "no",
      "Se cobra por visita",
    ],
  ];
}
