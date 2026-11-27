"use client";

// ============================================================
// /cobranza/comprobantes — enlaces de pago y revisión de comprobantes.
//
// Tres paneles en orden de uso diario:
//   1. Revisar comprobantes (aprobar aplica el pago a la cartera).
//   2. Generar un enlace para un deudor con saldo.
//   3. Datos bancarios que verá el deudor en la página pública.
//
// Aprobar usa `collection_receipt_review` (migración 135): el pago
// entra por los triggers existentes de la cartera. La UI nunca calcula
// saldos por su cuenta; los pide a la base.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Landmark,
  Link2,
  Loader2,
  Receipt,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";

import { Panel } from "@/components/metrics/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { formatDate, formatUsd } from "@/lib/collections/format";
import {
  DEFAULT_PAYMENT_SETTINGS,
  receiptStatusLabel,
  type CollectionReceipt,
  type PaymentSettings,
  type ReceiptStatus,
} from "@/lib/collections/payment-links-shared";

interface SettingsPayload {
  settings: PaymentSettings;
  persisted: boolean;
  migration_pending: boolean;
  site_url_configured: boolean;
}

interface ReceiptsPayload {
  receipts: CollectionReceipt[];
  counts: Record<ReceiptStatus, number>;
  migration_pending: boolean;
}

interface DebtorResult {
  id: string;
  name: string;
  phone_primary: string | null;
  status: string;
  balance: number;
}

interface GeneratedLink {
  debtor: { id: string; name: string; balance: number };
  link: {
    token: string;
    url: string;
    amount: number | null;
    expires_at: string;
    created: boolean;
  };
}

interface OpenInstallment {
  id: string;
  number: number;
  due_date: string;
  total: number;
  paid_amount: number;
}

const selectClass =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const STATUS_TABS: Array<{ value: ReceiptStatus | "all"; label: string }> = [
  { value: "pending", label: "Pendientes" },
  { value: "approved", label: "Aprobados" },
  { value: "rejected", label: "Rechazados" },
  { value: "all", label: "Todos" },
];

function statusTone(status: ReceiptStatus): string {
  switch (status) {
    case "pending":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "approved":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "rejected":
      return "border-red-500/40 bg-red-500/10 text-red-300";
  }
}

function balanceOf(rows: OpenInstallment[]): number {
  return rows.reduce(
    (sum, row) => sum + Math.max(0, row.total - row.paid_amount),
    0,
  );
}

export default function ComprobantesPage() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan("edit-settings");

  // --- Configuración de pago -------------------------------------------
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [settingsMeta, setSettingsMeta] = useState<{
    migration_pending: boolean;
    site_url_configured: boolean;
  }>({ migration_pending: false, site_url_configured: false });
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // --- Comprobantes ----------------------------------------------------
  const [status, setStatus] = useState<ReceiptStatus | "all">("pending");
  const [receipts, setReceipts] = useState<CollectionReceipt[]>([]);
  const [counts, setCounts] = useState<Record<ReceiptStatus, number>>({
    pending: 0,
    approved: 0,
    rejected: 0,
  });
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [receiptsMigrationPending, setReceiptsMigrationPending] =
    useState(false);

  // --- Revisión --------------------------------------------------------
  const [reviewing, setReviewing] = useState<CollectionReceipt | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewInstallment, setReviewInstallment] = useState("");
  const [reviewInstallments, setReviewInstallments] = useState<
    OpenInstallment[]
  >([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewingBusy, setReviewingBusy] = useState(false);

  // --- Generador de enlaces -------------------------------------------
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DebtorResult[] | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedLink | null>(null);
  const [copied, setCopied] = useState(false);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch("/api/cobranza/configuracion-pagos", {
        cache: "no-store",
      });
      const json = (await res.json()) as SettingsPayload & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo cargar.");
      setSettings(json.settings);
      setSettingsMeta({
        migration_pending: json.migration_pending,
        site_url_configured: json.site_url_configured,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cargar.");
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const loadReceipts = useCallback(
    async (nextStatus: ReceiptStatus | "all" = status) => {
      setReceiptsLoading(true);
      try {
        const res = await fetch(
          `/api/cobranza/comprobantes?status=${encodeURIComponent(nextStatus)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as ReceiptsPayload & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "No se pudo cargar.");
        setReceipts(json.receipts);
        setCounts(json.counts);
        setReceiptsMigrationPending(json.migration_pending);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "No se pudieron cargar.",
        );
      } finally {
        setReceiptsLoading(false);
      }
    },
    [status],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings();
  }, [loadSettings, accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadReceipts(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, accountId]);

  function updateSettings(patch: Partial<PaymentSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  async function saveSettings() {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const res = await fetch("/api/cobranza/configuracion-pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = (await res.json()) as SettingsPayload & { error?: string };
      if (!res.ok || !json.settings) {
        toast.error(json.error ?? "No se pudo guardar.");
        return;
      }
      setSettings(json.settings);
      toast.success("Datos de pago guardados.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function searchDebtors(event?: React.FormEvent) {
    event?.preventDefault();
    if (!accountId) return;
    const term = query.trim();
    if (term.length < 2) {
      toast.error("Escribe al menos dos letras del nombre.");
      return;
    }
    setSearching(true);
    setGenerated(null);
    try {
      const { data: debtors, error } = await supabase
        .from("collection_debtors")
        .select("id, name, phone_primary, status")
        .eq("account_id", accountId)
        .ilike("name", `%${term}%`)
        .not("status", "in", "(pagado,ilocalizable,juridico)")
        .order("name", { ascending: true })
        .limit(20);
      if (error) throw new Error(error.message);

      const rows = debtors ?? [];
      const ids = rows.map((row) => row.id as string);
      const balances = new Map<string, number>();
      if (ids.length > 0) {
        const { data: installments, error: instError } = await supabase
          .from("collection_installments")
          .select("debtor_id, total, paid_amount")
          .eq("account_id", accountId)
          .in("debtor_id", ids)
          .in("status", ["pending", "partial"]);
        if (instError) throw new Error(instError.message);
        for (const row of installments ?? []) {
          const key = row.debtor_id as string;
          const value =
            Math.max(
              0,
              Number(row.total ?? 0) - Number(row.paid_amount ?? 0),
            ) || 0;
          balances.set(key, (balances.get(key) ?? 0) + value);
        }
      }

      setResults(
        rows.map((row) => ({
          id: row.id as string,
          name: (row.name as string) ?? "Deudor",
          phone_primary: (row.phone_primary as string | null) ?? null,
          status: (row.status as string) ?? "nuevo",
          balance: balances.get(row.id as string) ?? 0,
        })),
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo buscar deudores.",
      );
    } finally {
      setSearching(false);
    }
  }

  async function generateLink(debtor: DebtorResult) {
    setGeneratingId(debtor.id);
    setGenerated(null);
    try {
      const res = await fetch("/api/cobranza/enlaces-pago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debtor_id: debtor.id }),
      });
      const json = (await res.json()) as GeneratedLink & { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo generar el enlace.");
        return;
      }
      setGenerated(json);
      toast.success(
        json.link.created ? "Enlace creado." : "Enlace activo reutilizado.",
      );
    } finally {
      setGeneratingId(null);
    }
  }

  async function copyLink() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.link.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("El navegador no permitió copiar. Selecciona la URL.");
    }
  }

  async function openReview(receipt: CollectionReceipt) {
    setReviewing(receipt);
    setReviewNotes("");
    setReviewInstallment("");
    setReviewInstallments([]);
    setReviewLoading(true);
    try {
      const { data, error } = await supabase
        .from("collection_installments")
        .select("id, number, due_date, total, paid_amount")
        .eq("account_id", receipt.account_id)
        .eq("debtor_id", receipt.debtor_id)
        .in("status", ["pending", "partial"])
        .order("due_date", { ascending: true })
        .order("number", { ascending: true });
      if (error) throw new Error(error.message);
      setReviewInstallments(
        ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
          id: row.id as string,
          number: Number(row.number) || 0,
          due_date: row.due_date as string,
          total: Number(row.total) || 0,
          paid_amount: Number(row.paid_amount) || 0,
        })),
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudieron leer las cuotas.",
      );
    } finally {
      setReviewLoading(false);
    }
  }

  async function review(decision: "approve" | "reject") {
    if (!reviewing) return;
    if (decision === "approve") {
      const where = reviewInstallment
        ? "la cuota seleccionada"
        : "las cuotas abiertas, de la más antigua a la más nueva";
      if (
        !window.confirm(
          `Se aplicará ${formatUsd(Number(reviewing.amount))} a ${where} de ${reviewing.debtor_name ?? "el deudor"}. Esta acción no se puede deshacer. ¿Continuar?`,
        )
      ) {
        return;
      }
    }

    setReviewingBusy(true);
    try {
      const res = await fetch(
        `/api/cobranza/comprobantes/${reviewing.id}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            installment_id: reviewInstallment || undefined,
            notes: reviewNotes.trim() || undefined,
          }),
        },
      );
      const json = (await res.json()) as {
        receipt?: CollectionReceipt;
        error?: string;
      };
      if (!res.ok || !json.receipt) {
        toast.error(json.error ?? "No se pudo revisar el comprobante.");
        return;
      }
      toast.success(
        decision === "approve" ? "Pago aplicado a la cartera." : "Comprobante rechazado.",
      );
      setReviewing(null);
      await loadReceipts(status);
    } finally {
      setReviewingBusy(false);
    }
  }

  const tabCount = useCallback(
    (value: ReceiptStatus | "all") =>
      value === "all"
        ? counts.pending + counts.approved + counts.rejected
        : counts[value],
    [counts],
  );

  const selectedBalance = useMemo(
    () => balanceOf(reviewInstallments),
    [reviewInstallments],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Enlaces de pago y comprobantes
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Comparte un enlace con el saldo real del deudor, recibe su
            comprobante y apruébalo para que entre a la cartera.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void loadSettings();
            void loadReceipts(status);
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Actualizar
        </Button>
      </div>

      {/* 1. Comprobantes ------------------------------------------------- */}
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            Revisar comprobantes
          </span>
        }
        subtitle="Aprobar aplica el pago a las cuotas abiertas del deudor"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatus(tab.value)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  status === tab.value
                    ? "border-primary/50 bg-primary/15 text-foreground"
                    : "border-border bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-[10px] opacity-70">
                  {tabCount(tab.value)}
                </span>
              </button>
            ))}
          </div>
        }
      >
        {receiptsMigrationPending ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Falta aplicar la migración 135. Ejecuta{" "}
            <span className="font-mono">PROD_UPDATE_135.sql</span> en Supabase y
            recarga.
          </div>
        ) : receiptsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando comprobantes…
          </div>
        ) : receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {status === "pending"
              ? "No hay comprobantes pendientes. Los que reporten los deudores desde su enlace aparecerán aquí."
              : "No hay comprobantes en esta bandeja."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Reportado</th>
                  <th className="px-3 py-2 text-left font-medium">Deudor</th>
                  <th className="px-3 py-2 text-right font-medium">Monto</th>
                  <th className="px-3 py-2 text-left font-medium">Referencia</th>
                  <th className="px-3 py-2 text-left font-medium">Banco</th>
                  <th className="px-3 py-2 text-left font-medium">Pago</th>
                  <th className="px-3 py-2 text-left font-medium">Estado</th>
                  <th className="px-3 py-2 text-right font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.id} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDate(receipt.created_at)}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {receipt.debtor_name ?? "Deudor"}
                    </td>
                    <td className="px-3 py-2 text-right text-foreground">
                      {formatUsd(Number(receipt.amount))}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {receipt.reference ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {receipt.bank ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDate(receipt.paid_at)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone(receipt.status)}`}
                      >
                        {receiptStatusLabel(receipt.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {receipt.status === "pending" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void openReview(receipt)}
                        >
                          Revisar
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {receipt.reviewed_at
                            ? formatDate(receipt.reviewed_at)
                            : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {reviewing ? (
          <div className="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Revisar comprobante de {reviewing.debtor_name ?? "deudor"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatUsd(Number(reviewing.amount))} · Ref.{" "}
                  <span className="font-mono">{reviewing.reference ?? "—"}</span>{" "}
                  · {formatDate(reviewing.paid_at)}
                  {reviewing.notes ? ` · “${reviewing.notes}”` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewing(null)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Cerrar revisión"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  Aplicar a una cuota concreta (opcional)
                </Label>
                <select
                  className={selectClass}
                  value={reviewInstallment}
                  onChange={(event) => setReviewInstallment(event.target.value)}
                  disabled={reviewLoading || reviewingBusy}
                >
                  <option value="">
                    Reparto automático (más antigua primero)
                  </option>
                  {reviewInstallments.map((installment) => (
                    <option key={installment.id} value={installment.id}>
                      Cuota #{installment.number} · vence{" "}
                      {formatDate(installment.due_date)} ·{" "}
                      {formatUsd(
                        Math.max(
                          0,
                          installment.total - installment.paid_amount,
                        ),
                      )}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Saldo abierto del deudor: {formatUsd(selectedBalance)}
                  {reviewLoading ? " · cargando cuotas…" : ""}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  Nota de revisión (opcional)
                </Label>
                <Textarea
                  rows={2}
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                  placeholder="Ej. verificado contra el estado de cuenta"
                  maxLength={2000}
                  disabled={reviewingBusy}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void review("approve")}
                disabled={reviewingBusy}
              >
                {reviewingBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Aprobar y aplicar pago
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void review("reject")}
                disabled={reviewingBusy}
              >
                <X className="mr-2 h-4 w-4" />
                Rechazar
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      {/* 2. Generar enlace ----------------------------------------------- */}
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            Generar enlace de pago
          </span>
        }
        subtitle="El deudor ve su saldo real y reporta la transferencia sin crear cuenta"
      >
        <form onSubmit={searchDebtors} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 space-y-2">
            <Label className="text-muted-foreground">Buscar deudor</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nombre del deudor…"
                className="pl-8"
              />
            </div>
          </div>
          <Button type="submit" variant="outline" disabled={searching}>
            {searching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Buscar
          </Button>
        </form>

        {results ? (
          results.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Ningún deudor activo coincide con “{query.trim()}”.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-border rounded-lg border border-border">
              {results.map((debtor) => (
                <div
                  key={debtor.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {debtor.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {debtor.phone_primary ?? "sin teléfono"} · {debtor.status} ·{" "}
                      {formatUsd(debtor.balance)} abiertos
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void generateLink(debtor)}
                    disabled={
                      debtor.balance <= 0.005 || generatingId === debtor.id
                    }
                  >
                    {generatingId === debtor.id ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Link2 className="mr-2 h-3.5 w-3.5" />
                    )}
                    {debtor.balance <= 0.005 ? "Sin saldo" : "Generar enlace"}
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : null}

        {generated ? (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              {generated.link.created ? "Enlace creado" : "Enlace activo reutilizado"}
              {" · "}
              {generated.debtor.name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Saldo abierto {formatUsd(generated.debtor.balance)} · vence{" "}
              {formatDate(generated.link.expires_at)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                readOnly
                value={generated.link.url}
                className="min-w-[260px] flex-1 font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button type="button" size="sm" variant="outline" onClick={() => void copyLink()}>
                {copied ? (
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="mr-2 h-3.5 w-3.5" />
                )}
                {copied ? "Copiado" : "Copiar"}
              </Button>
              <a
                href={generated.link.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-muted px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir
              </a>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Envíalo por WhatsApp o correo. El deudor no necesita cuenta y el
              enlace deja de servir cuando la deuda queda saldada.
            </p>
          </div>
        ) : null}
      </Panel>

      {/* 3. Datos para pagar --------------------------------------------- */}
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" />
            Datos para pagar
          </span>
        }
        subtitle="Lo que ve el deudor en su enlace público"
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {settings?.enabled ? "Activo" : "Apagado"}
              </span>
              <Switch
                checked={settings?.enabled ?? false}
                onCheckedChange={(checked) =>
                  updateSettings({ enabled: Boolean(checked) })
                }
                disabled={!canEdit || settingsLoading}
                aria-label="Activar enlaces de pago"
              />
            </div>
            {canEdit ? (
              <Button
                type="button"
                size="sm"
                onClick={() => void saveSettings()}
                disabled={savingSettings || settingsLoading}
              >
                {savingSettings ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Guardar
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                Solo administradores
              </span>
            )}
          </div>
        }
      >
        {settingsMeta.migration_pending ? (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Falta aplicar la migración 135. Ejecuta{" "}
            <span className="font-mono">PROD_UPDATE_135.sql</span> en Supabase y
            recarga.
          </div>
        ) : null}

        {!settingsMeta.site_url_configured ? (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            No hay <span className="font-mono">NEXT_PUBLIC_SITE_URL</span>{" "}
            configurada. Los enlaces se arman con el dominio de la solicitud al
            generarlos, pero el cron de recordatorios no podrá incluirlos.
          </div>
        ) : null}

        {settingsLoading || !settings ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando datos de pago…
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Banco</Label>
                <Input
                  value={settings.bank_name ?? ""}
                  onChange={(event) =>
                    updateSettings({ bank_name: event.target.value || null })
                  }
                  placeholder="Ej. Banesco"
                  maxLength={120}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Número de cuenta</Label>
                <Input
                  value={settings.account_number ?? ""}
                  onChange={(event) =>
                    updateSettings({ account_number: event.target.value || null })
                  }
                  placeholder="0102 0000 0000 0000 0000"
                  maxLength={40}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Tipo de cuenta</Label>
                <Input
                  value={settings.account_type ?? ""}
                  onChange={(event) =>
                    updateSettings({ account_type: event.target.value || null })
                  }
                  placeholder="Corriente / Ahorro"
                  maxLength={40}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Titular</Label>
                <Input
                  value={settings.account_holder ?? ""}
                  onChange={(event) =>
                    updateSettings({ account_holder: event.target.value || null })
                  }
                  placeholder="Razón social o nombre"
                  maxLength={160}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Documento / RIF</Label>
                <Input
                  value={settings.holder_document ?? ""}
                  onChange={(event) =>
                    updateSettings({
                      holder_document: event.target.value || null,
                    })
                  }
                  placeholder="J-12345678-9"
                  maxLength={40}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  Vigencia del enlace (días)
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={settings.link_expiry_days}
                  onChange={(event) =>
                    updateSettings({
                      link_expiry_days: Number(event.target.value) || 1,
                    })
                  }
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Banco del pago móvil</Label>
                <Input
                  value={settings.mobile_payment_bank ?? ""}
                  onChange={(event) =>
                    updateSettings({
                      mobile_payment_bank: event.target.value || null,
                    })
                  }
                  placeholder="Ej. Banesco"
                  maxLength={80}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Teléfono del pago móvil</Label>
                <Input
                  value={settings.mobile_payment_phone ?? ""}
                  onChange={(event) =>
                    updateSettings({
                      mobile_payment_phone: event.target.value || null,
                    })
                  }
                  placeholder="0414 1234567"
                  maxLength={40}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  WhatsApp de soporte
                </Label>
                <Input
                  value={settings.support_phone ?? ""}
                  onChange={(event) =>
                    updateSettings({ support_phone: event.target.value || null })
                  }
                  placeholder="+58 414 1234567"
                  maxLength={40}
                  disabled={!canEdit}
                />
                <p className="text-[11px] text-muted-foreground">
                  Alimenta el botón “Enviar comprobante por WhatsApp”.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <Label className="text-muted-foreground">
                Instrucciones adicionales
              </Label>
              <Textarea
                rows={3}
                value={settings.instructions ?? ""}
                onChange={(event) =>
                  updateSettings({ instructions: event.target.value || null })
                }
                placeholder="Ej. Envía el comprobante el mismo día. Los pagos en divisas se reciben en efectivo en oficina."
                maxLength={2000}
                disabled={!canEdit}
              />
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Predeterminados de esta instalación:{" "}
              {DEFAULT_PAYMENT_SETTINGS.link_expiry_days} días de vigencia. Si
              el enlace está activo, el deudor verá exactamente estos datos.
            </p>
          </>
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        La página pública no muestra documento, teléfono ni correo del deudor.
        Aprobar un comprobante registra el pago en la cartera con la referencia
        bancaria; rechazarlo no toca saldos.
      </p>
    </div>
  );
}
