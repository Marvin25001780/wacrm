"use client";

// ============================================================
// /pagar/[token] — el deudor ve su saldo real, cómo pagar y reporta
// la transferencia. Sin login: todo pasa por las RPC públicas de la
// migración 135, que solo exponen datos no sensibles.
//
// Reglas de honestidad:
//   * Si el negocio no cargó datos bancarios, no se inventan: se
//     invita a pedirlos al asesor.
//   * El comprobante queda PENDIENTE hasta que un admin lo revise.
//     La página lo dice tal cual; nunca promete aplicación inmediata.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Copy,
  Landmark,
  Loader2,
  MessageCircle,
  Receipt,
  Send,
  ShieldCheck,
  Smartphone,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatUsd, todayIso } from "@/lib/collections/format";
import {
  instructionRows,
  paymentLinkReasonLabel,
  phoneDigits,
  referenceError,
  type PublicPaymentLink,
} from "@/lib/collections/payment-links-shared";

type LoadState =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "ready"; data: Extract<PublicPaymentLink, { ok: true }> };

interface ReceiptResult {
  receipt_id: string;
  status: string;
}

const card =
  "rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6";
const muted = "text-sm text-muted-foreground";

export default function PagarPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [bank, setBank] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/public/pagar/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as PublicPaymentLink & {
        error?: string;
      };
      if (!json.ok) {
        setState({ status: "error", reason: json.reason ?? "not_found" });
        return;
      }
      setState({ status: "ready", data: json });
      // El saldo vivo manda sobre el monto congelado al crear el enlace:
      // si el deudor ya abonó, el formulario no debe sugerir de más.
      const suggested = Number(json.total_balance) || 0;
      setAmount(suggested > 0 ? suggested.toFixed(2) : "");
    } catch {
      setState({ status: "error", reason: "server_error" });
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // El navegador puede negar el portapapeles; el dato sigue visible.
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token || state.status !== "ready") return;

    setFormError(null);
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setFormError("Escribe el monto que transferiste.");
      return;
    }
    const refError = referenceError(reference);
    if (refError) {
      setFormError(refError);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/public/pagar/${encodeURIComponent(token)}/comprobante`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: numeric,
            paid_at: paidAt || null,
            reference: reference.trim(),
            bank: bank.trim() || null,
            notes: notes.trim() || null,
          }),
        },
      );
      const json = (await res.json()) as ReceiptResult & { error?: string };
      if (!res.ok) {
        setFormError(json.error ?? "No se pudo enviar el comprobante.");
        return;
      }
      setReceipt(json);
    } catch {
      setFormError("No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <div className={`${card} flex items-center gap-3`}>
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <p className={muted}>Cargando tu estado de cuenta…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={card}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <h1 className="text-lg font-semibold">Enlace no disponible</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.reason === "server_error"
                ? "No pudimos cargar tu enlace en este momento. Intenta recargar la página."
                : paymentLinkReasonLabel(state.reason)}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => void load()}
            >
              Reintentar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const data = state.data;
  const rows = instructionRows(data.instructions);
  const hasInstructions = Boolean(
    data.instructions.enabled &&
      (rows.length > 0 || data.instructions.notes),
  );
  const supportDigits = phoneDigits(data.instructions.support_phone);
  const whatsappText = encodeURIComponent(
    `Hola, quiero enviar mi comprobante de pago de ${data.debtor_name}.` +
      (reference.trim() ? ` Referencia: ${reference.trim()}.` : "") +
      (Number(amount) > 0 ? ` Monto: ${formatUsd(Number(amount))}.` : ""),
  );

  if (receipt) {
    return (
      <div className="space-y-4">
        <div className={`${card} border-emerald-500/40 bg-emerald-500/5`}>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
            <div>
              <h1 className="text-lg font-semibold">Comprobante recibido</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Tu reporte quedó <span className="font-medium text-foreground">pendiente de revisión</span>.
                Un asesor de {data.business_name} verificará la transferencia y
                aplicará el pago a tu saldo. No necesitas enviarlo otra vez.
              </p>
              <p className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                Folio: <span className="font-mono text-foreground">{receipt.receipt_id.slice(0, 8)}</span>
                {" · "}
                Referencia: <span className="font-mono text-foreground">{reference.trim()}</span>
                {" · "}
                Monto: <span className="font-medium text-foreground">{formatUsd(Number(amount))}</span>
              </p>
              {supportDigits ? (
                <a
                  href={`https://wa.me/${supportDigits}?text=${whatsappText}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
                >
                  <MessageCircle className="h-4 w-4" />
                  Avisar por WhatsApp
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
            <Building2 className="h-3.5 w-3.5" />
            {data.business_name}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Hola, {data.debtor_name}</h1>
          <p className={muted}>
            Este es tu estado de cuenta y la forma de reportar tu pago.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          Enlace privado
        </span>
      </header>

      <section className={`${card} border-primary/30 bg-gradient-to-br from-primary/10 to-transparent`}>
        <p className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Wallet className="h-4 w-4 text-primary" />
          Saldo pendiente
        </p>
        <p className="mt-2 text-4xl font-semibold tracking-tight">
          {formatUsd(Number(data.total_balance) || 0)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {data.installments.length} cuota
          {data.installments.length === 1 ? "" : "s"} abierta
          {data.installments.length === 1 ? "" : "s"}
          {data.instructions.enabled
            ? " · Puedes pagar el total o una parte."
            : " · Tu asesor te confirmará los datos para pagar."}
        </p>
        {data.installments.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Cuota</th>
                  <th className="px-3 py-2 text-left font-medium">Vence</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {data.installments.map((installment) => (
                  <tr
                    key={`${installment.number}-${installment.due_date}`}
                    className="border-t border-border"
                  >
                    <td className="px-3 py-2 text-foreground">
                      #{installment.number}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDate(installment.due_date)}
                    </td>
                    <td className="px-3 py-2 text-right text-foreground">
                      {formatUsd(Number(installment.balance) || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className={card}>
        <h2 className="inline-flex items-center gap-2 text-base font-semibold">
          <Landmark className="h-4 w-4 text-primary" />
          Datos para pagar
        </h2>
        {hasInstructions ? (
          <div className="mt-3 space-y-2">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
              >
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {row.label}
                </span>
                <span className="inline-flex items-center gap-2 text-sm text-foreground">
                  {row.value}
                  <button
                    type="button"
                    onClick={() => void copy(row.value, row.label)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={`Copiar ${row.label}`}
                  >
                    {copied === row.label ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </span>
              </div>
            ))}
            {data.instructions.notes ? (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                {data.instructions.notes}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            El negocio todavía no cargó sus datos bancarios. Pídeselos a tu
            asesor antes de transferir.
          </p>
        )}
        {data.instructions.mobile_payment_phone ? (
          <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Smartphone className="h-3.5 w-3.5" />
            Pago móvil: {data.instructions.mobile_payment_bank ?? ""}{" "}
            {data.instructions.mobile_payment_phone}
          </p>
        ) : null}
      </section>

      <section className={card}>
        <h2 className="inline-flex items-center gap-2 text-base font-semibold">
          <Receipt className="h-4 w-4 text-primary" />
          Reportar mi pago
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Después de transferir, registra aquí la referencia. Queda pendiente
          hasta que un asesor la verifique.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <input
            type="text"
            name="website"
            className="hidden"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="amount">Monto transferido (USD)</Label>
              <Input
                id="amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paid_at">Fecha del pago</Label>
              <Input
                id="paid_at"
                type="date"
                value={paidAt}
                max={todayIso()}
                onChange={(event) => setPaidAt(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference">Referencia de la transferencia</Label>
              <Input
                id="reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Ej. 0123456789"
                maxLength={80}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bank">Banco emisor (opcional)</Label>
              <Input
                id="bank"
                value={bank}
                onChange={(event) => setBank(event.target.value)}
                placeholder="Ej. Banesco"
                maxLength={80}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Nota para el asesor (opcional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Ej. Transferí desde la cuenta de mi esposa."
              rows={2}
              maxLength={1000}
            />
          </div>

          {formError ? (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {formError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Enviar comprobante
            </Button>
            {supportDigits ? (
              <a
                href={`https://wa.me/${supportDigits}?text=${whatsappText}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
              >
                <MessageCircle className="h-4 w-4" />
                Enviar comprobante por WhatsApp
              </a>
            ) : null}
          </div>
        </form>
      </section>

      <p className="px-1 text-center text-[11px] text-muted-foreground">
        {data.business_name} · Enlace válido hasta {formatDate(data.expires_at)}.
        No compartas este enlace: es personal.
      </p>
    </div>
  );
}
