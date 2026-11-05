"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Upload,
  X,
} from "lucide-react";

import { PosButton } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import { CATEGORY_COLORS, type Category, type Product } from "@/components/pos/catalog/types";
import { downloadCsv, normalizeHeader } from "@/lib/pos/csv";
import {
  IMPORT_HEADERS,
  parseProductsCsv,
  templateRows,
  type ParseProductsResult,
} from "@/lib/pos/product-import";
import { formatUsd, toNumber } from "@/lib/pos/money";

interface ImportResult {
  created: number;
  skipped: number;
  stock: number;
  categories: number;
  error?: string;
}

export function ImportProductsDialog({
  accountId,
  categories,
  products,
  onClose,
  onImported,
}: {
  accountId: string | null;
  categories: Category[];
  products: Product[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseProductsResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const ready = useMemo(
    () => (parsed ? parsed.rows.filter((row) => !row.error) : []),
    [parsed],
  );
  const failed = useMemo(
    () => (parsed ? parsed.rows.filter((row) => row.error) : []),
    [parsed],
  );
  const newCategories = useMemo(() => {
    if (!parsed) return [];
    return [
      ...new Set(
        ready
          .filter((row) => row.categoryName && !row.categoryId)
          .map((row) => row.categoryName as string),
      ),
    ];
  }, [parsed, ready]);

  async function handleFile(file: File | null) {
    setResult(null);
    setParseError(null);
    setParsed(null);
    setFileName(null);
    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      setParseError("El archivo supera 4 MB. Divídelo en partes.");
      return;
    }

    const text = await file.text();
    if (!text.trim()) {
      setParseError("El archivo está vacío.");
      return;
    }

    const next = parseProductsCsv(
      text,
      categories.map((category) => ({ id: category.id, name: category.name })),
      products.map((product) => ({
        sku: product.sku,
        barcode: product.barcode,
      })),
    );

    if (next.missingColumns.length > 0) {
      setParseError(
        `Falta la columna obligatoria: ${next.missingColumns.join(", ")}. Descarga la plantilla para ver el formato.`,
      );
      return;
    }
    if (next.rows.length === 0) {
      setParseError("No hay filas de datos debajo de la cabecera.");
      return;
    }

    setFileName(file.name);
    setParsed(next);
  }

  async function runImport() {
    if (!accountId || !parsed) return;
    const valid = parsed.rows.filter((row) => !row.error);
    if (valid.length === 0) {
      setParseError("No hay filas válidas para importar.");
      return;
    }

    setImporting(true);
    setParseError(null);
    setResult(null);
    const supabase = createClient();

    // 1. Categorías que el archivo menciona y todavía no existen.
    const missingNames = [
      ...new Set(
        valid
          .filter((row) => row.categoryName && !row.categoryId)
          .map((row) => row.categoryName as string),
      ),
    ];
    let categoryMap = new Map(
      categories.map((category) => [
        normalizeHeader(category.name),
        category.id,
      ]),
    );

    if (missingNames.length > 0) {
      const { error: categoryError } = await supabase
        .from("pos_categories")
        .upsert(
          missingNames.map((name, index) => ({
            account_id: accountId,
            name,
            color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
          })),
          { onConflict: "account_id,name", ignoreDuplicates: true },
        );
      if (categoryError) {
        setImporting(false);
        setParseError(
          `No se pudieron crear las categorías: ${categoryError.message}`,
        );
        return;
      }
      const { data: categoryRows } = await supabase
        .from("pos_categories")
        .select("id, name")
        .eq("account_id", accountId);
      categoryMap = new Map(
        (categoryRows ?? []).map((row: { id: string; name: string }) => [
          normalizeHeader(row.name),
          row.id,
        ]),
      );
    }

    // 2. Productos en lotes. El stock inicial entra después como un
    //    conteo de inventario, igual que cuando se crea uno a mano.
    const BATCH = 100;
    let created = 0;
    let insertError: string | null = null;
    const stockRows: { id: string; stock: number }[] = [];

    for (let index = 0; index < valid.length; index += BATCH) {
      const chunk = valid.slice(index, index + BATCH);
      const { data, error } = await supabase
        .from("pos_products")
        .insert(
          chunk.map((row) => ({
            account_id: accountId,
            name: row.name,
            sku: row.sku,
            barcode: row.barcode,
            description: row.description,
            kind: row.kind,
            unit: row.unit,
            cost_usd: row.cost,
            price_usd: row.price,
            stock: 0,
            min_stock: row.minStock,
            taxable: row.taxable,
            track_inventory: row.trackInventory,
            active: true,
            category_id:
              row.categoryId ??
              (row.categoryName
                ? (categoryMap.get(normalizeHeader(row.categoryName)) ?? null)
                : null),
          })),
        )
        .select("id, name");

      if (error) {
        insertError = error.message;
        break;
      }

      const inserted = (data ?? []) as { id: string; name: string }[];
      created += inserted.length;
      inserted.forEach((product, position) => {
        const source = chunk[position];
        if (
          source &&
          source.kind !== "service" &&
          toNumber(source.stock) > 0
        ) {
          stockRows.push({ id: product.id, stock: toNumber(source.stock) });
        }
      });
    }

    // 3. Stock inicial en un solo documento de inventario.
    let stockApplied = 0;
    let stockError: string | null = null;
    if (stockRows.length > 0) {
      const { error } = await supabase.rpc("pos_create_adjustment", {
        p_payload: {
          type: "count",
          note: `Importación CSV · ${stockRows.length} producto(s)`,
          items: stockRows.map((row) => ({
            product_id: row.id,
            value: row.stock,
          })),
        },
      });
      if (error) stockError = error.message;
      else stockApplied = stockRows.length;
    }

    setImporting(false);
    setResult({
      created,
      skipped: parsed.rows.length - valid.length,
      stock: stockApplied,
      categories: missingNames.length,
      error: insertError ?? stockError ?? undefined,
    });

    if (created > 0) onImported();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div className="my-6 w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-900">
              Importar productos
            </h2>
            <p className="text-xs text-slate-500">
              Sube un CSV con los productos. Se revisa antes de guardar.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {!parsed && !result ? (
            <>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-4 py-8 text-center hover:border-[#4338ca] hover:bg-indigo-50/30">
                <Upload className="h-6 w-6 text-slate-400" />
                <span className="text-sm font-bold text-slate-700">
                  Elige un archivo CSV
                </span>
                <span className="text-xs text-slate-500">
                  Hasta 4 MB. La primera fila son los títulos.
                </span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    void handleFile(event.target.files?.[0] ?? null);
                    event.target.value = "";
                  }}
                />
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                <p className="font-bold text-slate-700">Columnas que entiende</p>
                <p className="mt-1 font-mono text-[10px] leading-relaxed text-slate-500">
                  {IMPORT_HEADERS.join(" · ")}
                </p>
                <p className="mt-2">
                  Obligatorias: <strong>nombre</strong> y{" "}
                  <strong>precio</strong> (salvo insumos). Los números aceptan
                  coma o punto. Si una categoría no existe, se crea.
                </p>
              </div>

              <button
                type="button"
                onClick={() => downloadCsv("plantilla-productos.csv", templateRows())}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#4338ca] hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Descargar plantilla con ejemplos
              </button>
            </>
          ) : null}

          {parseError ? (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {parseError}
            </p>
          ) : null}

          {parsed && !result ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">
                  <FileText className="h-3.5 w-3.5" />
                  {fileName}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-bold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {ready.length} listos
                </span>
                {failed.length > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 font-bold text-amber-700">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {failed.length} con error
                  </span>
                ) : null}
                {newCategories.length > 0 ? (
                  <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-bold text-[#4338ca]">
                    {newCategories.length} categoría(s) nueva(s)
                  </span>
                ) : null}
              </div>

              <div className="max-h-64 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Línea</th>
                      <th className="px-3 py-2">Nombre</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2 text-right">Precio</th>
                      <th className="px-3 py-2 text-right">Stock</th>
                      <th className="px-3 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsed.rows.slice(0, 50).map((row) => (
                      <tr
                        key={row.line}
                        className={row.error ? "bg-amber-50/50" : undefined}
                      >
                        <td className="px-3 py-2 text-slate-400">{row.line}</td>
                        <td className="px-3 py-2 font-medium text-slate-700">
                          {row.name || "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {row.sku ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          {formatUsd(row.price)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          {row.stock}
                        </td>
                        <td className="px-3 py-2">
                          {row.error ? (
                            <span className="text-amber-700">{row.error}</span>
                          ) : (
                            <span className="text-emerald-700">Listo</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {parsed.rows.length > 50 ? (
                <p className="text-[11px] text-slate-400">
                  Vista previa de las primeras 50 filas. Se importarán{" "}
                  {parsed.rows.length}.
                </p>
              ) : null}
            </>
          ) : null}

          {result ? (
            <div
              className={`rounded-xl px-4 py-4 text-sm ${
                result.error
                  ? "bg-amber-50 text-amber-800"
                  : "bg-emerald-50 text-emerald-800"
              }`}
            >
              <p className="font-bold">
                {result.created > 0
                  ? `${result.created} producto(s) importados`
                  : "No se importó ningún producto"}
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                <li>Con error y omitidos: {result.skipped}</li>
                <li>Stock inicial aplicado: {result.stock}</li>
                <li>Categorías nuevas: {result.categories}</li>
                {result.error ? <li>Fallo: {result.error}</li> : null}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            {result ? "Cerrar" : "Cancelar"}
          </button>
          {parsed && !result && ready.length > 0 ? (
            <PosButton onClick={() => void runImport()} disabled={importing}>
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Importar {ready.length}
            </PosButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
