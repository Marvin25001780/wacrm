"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exportToCsv } from "@/lib/export/csv";
import {
  CANONICAL_FIELDS,
  TEMPLATE_EXAMPLE,
  TEMPLATE_FIELDS,
  missingRequiredFields,
  type CanonicalField,
} from "@/lib/collections/import/columns";
import { formatUsd } from "@/lib/collections/format";
import type {
  CollectionImportSummary,
  ImportColumnMapping,
  ImportPreview,
  ImportPreviewRow,
} from "@/types/collections";
import { cn } from "@/lib/utils";

type Step = "upload" | "mapping" | "preview" | "done";
type Busy = "upload" | "validate" | "commit" | "cancel" | null;

interface ParseResult {
  batchId: string;
  portfolioId: string;
  headers: string[];
  mapping: ImportColumnMapping;
  rowCount: number;
  sample: Record<string, unknown>[];
}

interface ValidateResult {
  batchId: string;
  summary: ImportPreview["summary"];
  mapping: ImportColumnMapping;
  headers: string[];
  rows: ImportPreviewRow[];
  truncated: boolean;
}

const selectClass =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Campos de la plantilla, en el mismo orden en que se descargan. */
const PRIMARY_FIELDS = TEMPLATE_FIELDS.map((template) =>
  CANONICAL_FIELDS.find((field) => field.key === template.key),
).filter((field): field is CanonicalField => Boolean(field));

/** Campos que se aceptan pero no forman parte de la plantilla. */
const OPTIONAL_FIELDS = CANONICAL_FIELDS.filter(
  (field) => !TEMPLATE_FIELDS.some((template) => template.key === field.key),
);

export function ImportWizard() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [portfolioName, setPortfolioName] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ImportColumnMapping>({});
  const [sample, setSample] = useState<Record<string, unknown>[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(false);

  const [preview, setPreview] = useState<ValidateResult | null>(null);
  const [commitSummary, setCommitSummary] = useState<CollectionImportSummary | null>(null);

  const missing = missingRequiredFields(mapping);

  function reset() {
    setStep("upload");
    setBusy(null);
    setError(null);
    setFile(null);
    setPortfolioName("");
    setBatchId(null);
    setHeaders([]);
    setMapping({});
    setSample([]);
    setRowCount(0);
    setPortfolioId(null);
    setShowOptional(false);
    setPreview(null);
    setCommitSummary(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleUpload() {
    if (!file) {
      toast.error("Selecciona un archivo .xlsx o .csv.");
      return;
    }

    setBusy("upload");
    setError(null);

    try {
      const form = new FormData();
      form.append("file", file);
      if (portfolioName.trim()) form.append("portfolioName", portfolioName.trim());

      const response = await fetch("/api/cobranza/import/parse", {
        method: "POST",
        body: form,
      });
      const json = (await response.json().catch(() => ({}))) as Partial<ParseResult> & {
        error?: string;
      };
      if (!response.ok) throw new Error(json.error ?? "No se pudo leer el archivo.");

      setBatchId(json.batchId ?? null);
      setPortfolioId(json.portfolioId ?? null);
      setHeaders(json.headers ?? []);
      setMapping(json.mapping ?? {});
      setSample(json.sample ?? []);
      setRowCount(json.rowCount ?? 0);
      setStep("mapping");
      toast.success(`Archivo analizado: ${json.rowCount ?? 0} filas.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setBusy(null);
    }
  }

  async function handleValidate() {
    if (!batchId) return;

    setBusy("validate");
    setError(null);

    try {
      const response = await fetch(`/api/cobranza/import/${batchId}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mapping }),
      });
      const json = (await response.json().catch(() => ({}))) as Partial<ValidateResult> & {
        error?: string;
      };
      if (!response.ok) throw new Error(json.error ?? "No se pudo validar el archivo.");

      setPreview(json as ValidateResult);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo validar el archivo.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCommit() {
    if (!batchId) return;

    setBusy("commit");
    setError(null);

    try {
      const response = await fetch(`/api/cobranza/import/${batchId}/commit`, {
        method: "POST",
      });
      const json = (await response.json().catch(() => ({}))) as {
        summary?: CollectionImportSummary;
        error?: string;
      };
      if (!response.ok) throw new Error(json.error ?? "No se pudo confirmar la importación.");

      setCommitSummary(json.summary ?? null);
      setStep("done");
      toast.success("Cartera importada");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar la importación.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (!batchId) {
      reset();
      return;
    }

    setBusy("cancel");
    try {
      await fetch(`/api/cobranza/import/${batchId}/cancel`, { method: "POST" });
    } finally {
      setBusy(null);
      reset();
    }
  }

  function downloadTemplate() {
    exportToCsv(
      "plantilla-cobranza.csv",
      TEMPLATE_FIELDS.map((field) => field.label),
      [TEMPLATE_EXAMPLE],
      // Excel en español abre el archivo en columnas con `;`, y el
      // BOM evita que los acentos se vean como "TelÃ©fono".
      { delimiter: ";", bom: true },
    );
  }

  return (
    <div className="space-y-5">
      <Stepper step={step} />

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {step === "upload" ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Sube la cartera</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Excel (.xlsx) o CSV (.csv) de hasta 10 MB. La primera fila debe tener los
                encabezados.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Cada fila es una cuota</span>, no un
                crédito completo. Un crédito con 12 cuotas ocupa 12 filas con el mismo folio y
                número de cuota del 1 al 12. Si solo cargas las vencidas, sube solo esas.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            La plantilla trae {TEMPLATE_FIELDS.length} columnas:{" "}
            {TEMPLATE_FIELDS.map((field) => field.label).join(" · ")}.
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="portfolio-name" className="text-muted-foreground">
                Nombre de la cartera (opcional)
              </Label>
              <Input
                id="portfolio-name"
                value={portfolioName}
                onChange={(event) => setPortfolioName(event.target.value)}
                placeholder="Cartera agosto 2026"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portfolio-file" className="text-muted-foreground">
                Archivo
              </Label>
              <Input
                id="portfolio-file"
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv,.txt"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:text-foreground"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" />
              Descargar plantilla
            </Button>
            <Button type="button" onClick={handleUpload} disabled={busy === "upload" || !file}>
              {busy === "upload" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Analizar archivo
            </Button>
          </div>
        </section>
      ) : null}

      {step === "mapping" ? (
        <section className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Mapeo de columnas</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Detectamos {headers.length} columnas y {rowCount} filas. Revisa que cada campo
                  apunte a la columna correcta.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={reset}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Cambiar archivo
              </Button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PRIMARY_FIELDS.map((field) => (
                <MappingField
                  key={field.key}
                  field={field}
                  headers={headers}
                  value={mapping[field.key] ?? ""}
                  onChange={(value) =>
                    setMapping((current) => ({ ...current, [field.key]: value || null }))
                  }
                />
              ))}
            </div>

            {OPTIONAL_FIELDS.length > 0 ? (
              <div className="mt-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowOptional((value) => !value)}
                >
                  {showOptional ? "Ocultar" : "Mostrar"} campos opcionales (
                  {OPTIONAL_FIELDS.length})
                </Button>
                {showOptional ? (
                  <div className="mt-3 grid gap-3 rounded-lg border border-dashed border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {OPTIONAL_FIELDS.map((field) => (
                      <MappingField
                        key={field.key}
                        field={field}
                        headers={headers}
                        value={mapping[field.key] ?? ""}
                        onChange={(value) =>
                          setMapping((current) => ({ ...current, [field.key]: value || null }))
                        }
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {missing.length > 0 ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Faltan campos obligatorios: {missing.join(", ")}.</span>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleCancel} disabled={busy === "cancel"}>
                Descartar lote
              </Button>
              <Button
                type="button"
                onClick={handleValidate}
                disabled={busy === "validate" || missing.length > 0}
              >
                {busy === "validate" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-2 h-4 w-4" />
                )}
                Validar filas
              </Button>
            </div>
          </div>

          {sample.length > 0 ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Muestra del archivo</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Primeras {sample.length} filas para verificar el mapeo.
              </p>
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHead key={header}>{header}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sample.map((row, index) => (
                      <TableRow key={index}>
                        {headers.map((header) => (
                          <TableCell key={header} className="max-w-48 truncate">
                            {String(row[header] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === "preview" && preview ? (
        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <SummaryCard label="Filas" value={preview.summary.total} />
            <SummaryCard label="Válidas" value={preview.summary.valid} tone="text-emerald-300" />
            <SummaryCard label="Advertencias" value={preview.summary.warning} tone="text-amber-300" />
            <SummaryCard label="Errores" value={preview.summary.error} tone="text-red-300" />
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Vista previa</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Se importarán las filas válidas y con advertencias. Las filas con error se
                  quedan fuera.
                  {preview.truncated ? " Mostrando las primeras 300." : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setStep("mapping")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Volver al mapeo
                </Button>
                <Button
                  type="button"
                  onClick={handleCommit}
                  disabled={
                    busy === "commit" ||
                    preview.summary.valid + preview.summary.warning === 0
                  }
                >
                  {busy === "commit" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Confirmar importación
                </Button>
              </div>
            </div>

            <div className="p-2 sm:p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fila</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Deudor</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead>Folio</TableHead>
                    <TableHead>Cuota</TableHead>
                    <TableHead>Vence</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Observaciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <PreviewRow key={row.rowNumber} row={row} mapping={preview.mapping} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>
      ) : null}

      {step === "done" ? (
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Cartera importada</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Los datos ya están disponibles en la cartera y en la ficha de cada deudor.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Deudores creados"
              value={commitSummary?.created_debtors ?? 0}
              tone="text-emerald-300"
            />
            <SummaryCard
              label="Créditos creados"
              value={commitSummary?.created_credits ?? 0}
              tone="text-emerald-300"
            />
            <SummaryCard
              label="Cuotas importadas"
              value={commitSummary?.created_installments ?? 0}
              tone="text-emerald-300"
            />
            <SummaryCard
              label="Cuotas actualizadas"
              value={commitSummary?.updated_installments ?? 0}
            />
            <SummaryCard label="Filas con error" value={commitSummary?.errors ?? 0} tone="text-red-300" />
            <SummaryCard label="Filas confirmadas" value={commitSummary?.committed_rows ?? 0} />
          </div>

          {commitSummary && commitSummary.committed_rows === 0 ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                No se guardó ninguna fila. Revisa que las filas válidas tengan documento, folio,
                número de cuota, fecha y total, y vuelve a importar.
              </span>
            </div>
          ) : null}

          {commitSummary && (commitSummary.errors ?? 0) > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {commitSummary.errors} fila(s) no se pudieron guardar. El resto sí quedó en la
              cartera.
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={portfolioId ? `/cobranza/cartera?portfolio=${portfolioId}` : "/cobranza/cartera"}>
              <Button type="button">
                Ver cartera
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Button type="button" variant="outline" onClick={reset}>
              <Upload className="mr-2 h-4 w-4" />
              Cargar otro archivo
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "Archivo" },
    { key: "mapping", label: "Mapeo" },
    { key: "preview", label: "Validación" },
    { key: "done", label: "Resultado" },
  ];
  const current = steps.findIndex((item) => item.key === step);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {steps.map((item, index) => (
        <div key={item.key} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold",
              index <= current
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {index + 1}
          </span>
          <span className={index <= current ? "text-foreground" : "text-muted-foreground"}>
            {item.label}
          </span>
          {index < steps.length - 1 ? <span className="mx-1 h-px w-6 bg-border" /> : null}
        </div>
      ))}
    </div>
  );
}

function MappingField({
  field,
  headers,
  value,
  onChange,
}: {
  field: CanonicalField;
  headers: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground">
        {field.label}
        {field.required ? <span className="ml-1 text-red-400">*</span> : null}
      </Label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(selectClass, !value && field.required && "border-amber-500/50")}
      >
        <option value="">— Sin mapear —</option>
        {headers.map((header) => (
          <option key={header} value={header}>
            {header}
          </option>
        ))}
      </select>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

function PreviewRow({
  row,
  mapping,
}: {
  row: ImportPreviewRow;
  mapping: ImportColumnMapping;
}) {
  const value = (key: string): string => {
    if (row.normalized) {
      const normalized = row.normalized as unknown as Record<string, unknown>;
      return String(normalized[key] ?? "");
    }
    const header = mapping[key];
    return header ? String(row.raw[header] ?? "") : "";
  };

  const tone =
    row.status === "valid"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : row.status === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
        : "border-red-500/40 bg-red-500/10 text-red-300";

  const messages = [...row.errors, ...row.warnings];

  return (
    <TableRow>
      <TableCell className="tabular-nums">{row.rowNumber}</TableCell>
      <TableCell>
        <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-medium", tone)}>
          {row.status === "valid" ? "Válida" : row.status === "warning" ? "Advertencia" : "Error"}
        </span>
      </TableCell>
      <TableCell>{value("name")}</TableCell>
      <TableCell>{value("document_number") || "—"}</TableCell>
      <TableCell>{value("folio")}</TableCell>
      <TableCell className="tabular-nums">{value("installment_number")}</TableCell>
      <TableCell>{value("due_date")}</TableCell>
      <TableCell className="text-right tabular-nums">
        {row.normalized
          ? formatUsd(row.normalized.principal + row.normalized.interest + row.normalized.late_fee)
          : value("total") || value("principal") || "—"}
      </TableCell>
      <TableCell className="max-w-72 whitespace-normal text-xs text-muted-foreground">
        {messages.length > 0 ? messages.join(" · ") : "—"}
      </TableCell>
    </TableRow>
  );
}
