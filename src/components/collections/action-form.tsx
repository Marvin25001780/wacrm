"use client";

// ============================================================
// Registro de gestión de cobranza (migración 125).
//
// Es el corazón de la consola: el agente tipifica la llamada y, si
// hubo acuerdo, crea la promesa de pago en el mismo paso. La lista de
// tipificaciones se lee de `collection_outcomes` (editable por el
// admin), no está escrita en el código.
//
// Vive como formulario y no como diálogo para poder usarlo en la
// consola (panel derecho) y dentro de un Dialog en la ficha del
// deudor sin duplicar campos.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, PhoneCall } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import {
  allowedDebtorStatuses,
  defaultPromiseDue,
  DEFAULT_ACTION_CHANNEL,
  renderScript,
  tramoForDays,
  validateActionInput,
  type ActionChannelInput,
} from "@/lib/collections/desk";
import { formatUsd, todayIso } from "@/lib/collections/format";
import {
  COLLECTION_CHANNELS,
  COLLECTION_DEBTOR_STATUSES,
  labelFor,
  type CollectionOutcome,
  type CollectionPolicy,
} from "@/types/collections";

const selectClass =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface ActionFormProps {
  debtorId: string;
  debtorName: string;
  daysOverdue: number;
  /** Llamada del softphone que se va a vincular (si hubo). */
  callSession?: { id: string; seconds?: number | null } | null;
  /** Saldo vencido, para el guión. */
  overdueBalance?: number;
  balance?: number;
  isAdmin?: boolean;
  /** Negocio activo: acota catálogo y política (el usuario puede tener varios). */
  accountId?: string | null;
  defaultChannel?: ActionChannelInput;
  /** Canal controlado por el padre (la consola lo cambia al enviar WhatsApp). */
  channel?: ActionChannelInput;
  onChannelChange?: (channel: ActionChannelInput) => void;
  onSaved: () => void;
}

interface CreditOption {
  id: string;
  folio: string;
  balance: number;
}

export function ActionForm({
  debtorId,
  debtorName,
  daysOverdue,
  callSession,
  overdueBalance = 0,
  balance = 0,
  isAdmin = false,
  accountId = null,
  defaultChannel = DEFAULT_ACTION_CHANNEL,
  channel: channelProp,
  onChannelChange,
  onSaved,
}: ActionFormProps) {
  const supabase = createClient();

  const [outcomes, setOutcomes] = useState<CollectionOutcome[]>([]);
  const [credits, setCredits] = useState<CreditOption[]>([]);
  const [policy, setPolicy] = useState<CollectionPolicy | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  const [level1, setLevel1] = useState("");
  const [level2, setLevel2] = useState("");
  const [internalChannel, setInternalChannel] =
    useState<ActionChannelInput>(defaultChannel);
  const channel = channelProp ?? internalChannel;
  function setChannel(next: ActionChannelInput) {
    if (onChannelChange) onChannelChange(next);
    if (channelProp === undefined) setInternalChannel(next);
  }
  const [notes, setNotes] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [creditId, setCreditId] = useState("");
  const [debtorStatus, setDebtorStatus] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadingCatalog(true);
    const tramo = tramoForDays(daysOverdue);

    let outcomeQuery = supabase
      .from("collection_outcomes")
      .select("*")
      .eq("active", true);
    if (accountId) {
      outcomeQuery = outcomeQuery.or(
        `account_id.is.null,account_id.eq.${accountId}`
      );
    }
    outcomeQuery = outcomeQuery
      .order("level", { ascending: true })
      .order("sort", { ascending: true });

    let policyQuery = supabase
      .from("collection_policies")
      .select("*")
      .eq("tramo", tramo)
      .eq("active", true);
    if (accountId) {
      policyQuery = policyQuery.eq("account_id", accountId);
    }

    const [outcomeRes, creditRes, installmentRes, policyRes] = await Promise.all([
      outcomeQuery,
      supabase
        .from("collection_credits")
        .select("id, folio, status")
        .eq("debtor_id", debtorId),
      supabase
        .from("collection_installments")
        .select("credit_id, total, paid_amount, status")
        .eq("debtor_id", debtorId),
      policyQuery.maybeSingle(),
    ]);

    setLoadingCatalog(false);

    if (outcomeRes.error) {
      console.error("[cobranza/action-form] outcomes", outcomeRes.error);
    }
    // El catálogo global y el del negocio pueden repetir el mismo
    // código: gana el del negocio, sin duplicar opciones.
    const catalog = new Map<string, CollectionOutcome>();
    for (const outcome of (outcomeRes.data ?? []) as CollectionOutcome[]) {
      if (!catalog.has(outcome.code) || outcome.account_id) {
        catalog.set(outcome.code, outcome);
      }
    }
    setOutcomes([...catalog.values()]);
    setPolicy((policyRes.data ?? null) as CollectionPolicy | null);

    const balances = new Map<string, number>();
    for (const row of (installmentRes.data ?? []) as Array<{
      credit_id: string;
      total: number;
      paid_amount: number;
      status: string;
    }>) {
      if (row.status !== "pending" && row.status !== "partial") continue;
      const pending = Math.max(0, Number(row.total) - Number(row.paid_amount));
      balances.set(row.credit_id, (balances.get(row.credit_id) ?? 0) + pending);
    }

    const list: CreditOption[] = (
      (creditRes.data ?? []) as Array<{ id: string; folio: string }>
    )
      .map((credit) => ({
        id: credit.id,
        folio: credit.folio,
        balance: balances.get(credit.id) ?? 0,
      }))
      .filter((credit) => credit.balance > 0);

    setCredits(list);
    setCreditId((current) =>
      list.some((credit) => credit.id === current)
        ? current
        : (list[0]?.id ?? "")
    );
  }, [accountId, daysOverdue, debtorId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const level1Options = useMemo(
    () => outcomes.filter((outcome) => outcome.level === 1),
    [outcomes]
  );

  const level2Options = useMemo(
    () =>
      outcomes.filter(
        (outcome) => outcome.level === 2 && outcome.parent_code === level1
      ),
    [level1, outcomes]
  );

  const level1Outcome = outcomes.find(
    (outcome) => outcome.level === 1 && outcome.code === level1
  );
  const level2Outcome = outcomes.find(
    (outcome) => outcome.level === 2 && outcome.code === level2
  );

  const requiresAmount = Boolean(
    level1Outcome?.requires_amount || level2Outcome?.requires_amount
  );
  const requiresDate = Boolean(
    level1Outcome?.requires_date || level2Outcome?.requires_date
  );
  const requiresReason = Boolean(
    level1Outcome?.requires_reason || level2Outcome?.requires_reason
  );
  const isPromise = level2 === "ptp";

  const script = useMemo(() => {
    if (!policy?.script_template) return "";
    return renderScript(policy.script_template, {
      nombre: debtorName,
      saldo: formatUsd(balance),
      vencido: formatUsd(overdueBalance),
      mora: daysOverdue,
      fecha: todayIso(),
    });
  }, [balance, debtorName, daysOverdue, overdueBalance, policy]);

  const statusOptions = useMemo(
    () =>
      COLLECTION_DEBTOR_STATUSES.filter((status) =>
        allowedDebtorStatuses(isAdmin).includes(status.value)
      ),
    [isAdmin]
  );

  function chooseLevel1(code: string) {
    setLevel1(code);
    setLevel2("");
    setErrors([]);
  }

  function chooseLevel2(code: string) {
    setLevel2(code);
    setErrors([]);
    if (code === "ptp" && !dueDate) {
      setDueDate(defaultPromiseDue(todayIso(), policy?.ptp_max_days ?? 7));
    }
  }

  function reset() {
    setLevel1("");
    setLevel2("");
    setNotes("");
    setAmount("");
    setDueDate("");
    setDebtorStatus("");
    setErrors([]);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const input = {
      level1,
      level2: level2 || null,
      channel,
      notes,
      amount: requiresAmount || isPromise ? Number(amount) || null : null,
      dueDate: requiresDate || isPromise ? dueDate || null : null,
      creditId: isPromise ? creditId || null : null,
    };

    const validation = validateActionInput(input, outcomes, {
      today: todayIso(),
      credits,
      policy,
    });
    if (validation.length > 0) {
      setErrors(validation);
      return;
    }

    setSaving(true);
    setErrors([]);
    try {
      const response = await fetch("/api/cobranza/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          debtorId,
          level1,
          level2: level2 || undefined,
          channel,
          notes: notes || undefined,
          amount: input.amount ?? undefined,
          dueDate: input.dueDate ?? undefined,
          creditId: input.creditId ?? undefined,
          debtorStatus: debtorStatus || undefined,
          callSessionId: callSession?.id ?? undefined,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        promiseId?: string | null;
      };
      if (!response.ok) {
        setErrors([json.error ?? "No se pudo registrar la gestión."]);
        return;
      }

      toast.success(
        json.promiseId ? "Gestión y promesa de pago guardadas" : "Gestión guardada"
      );
      reset();
      onSaved();
    } catch {
      setErrors(["Sin conexión con el servidor. La gestión no se guardó."]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {script ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Guión del tramo
          </p>
          <p className="whitespace-pre-wrap text-xs text-foreground">{script}</p>
        </div>
      ) : null}

      {callSession ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          <PhoneCall className="h-3.5 w-3.5" />
          Vinculada a la llamada
          {typeof callSession.seconds === "number"
            ? ` · ${Math.floor(callSession.seconds / 60)}:${String(
                callSession.seconds % 60
              ).padStart(2, "0")}`
            : ""}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="action-level1">Tipificación</Label>
        <select
          id="action-level1"
          className={selectClass}
          value={level1}
          onChange={(event) => chooseLevel1(event.target.value)}
          disabled={loadingCatalog}
        >
          <option value="">Selecciona…</option>
          {level1Options.map((outcome) => (
            <option key={outcome.code} value={outcome.code}>
              {outcome.label}
            </option>
          ))}
        </select>
      </div>

      {level2Options.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor="action-level2">Detalle</Label>
          <select
            id="action-level2"
            className={selectClass}
            value={level2}
            onChange={(event) => chooseLevel2(event.target.value)}
          >
            <option value="">Selecciona…</option>
            {level2Options.map((outcome) => (
              <option key={outcome.code} value={outcome.code}>
                {outcome.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {isPromise ? (
        <div className="space-y-1.5">
          <Label htmlFor="action-credit">Crédito</Label>
          <select
            id="action-credit"
            className={selectClass}
            value={creditId}
            onChange={(event) => setCreditId(event.target.value)}
          >
            <option value="">Selecciona…</option>
            {credits.map((credit) => (
              <option key={credit.id} value={credit.id}>
                {credit.folio} · {formatUsd(credit.balance)}
              </option>
            ))}
          </select>
          {credits.length === 0 ? (
            <p className="text-xs text-amber-300">
              Este deudor no tiene créditos con saldo abierto.
            </p>
          ) : null}
        </div>
      ) : null}

      {requiresAmount || isPromise ? (
        <div className="space-y-1.5">
          <Label htmlFor="action-amount">Monto comprometido (USD)</Label>
          <Input
            id="action-amount"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0,00"
          />
        </div>
      ) : null}

      {requiresDate || isPromise ? (
        <div className="space-y-1.5">
          <Label htmlFor="action-date">
            {isPromise ? "Fecha de la promesa" : "Fecha"}
          </Label>
          <Input
            id="action-date"
            type="date"
            value={dueDate}
            min={todayIso()}
            onChange={(event) => setDueDate(event.target.value)}
          />
          {isPromise && policy ? (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <CalendarClock className="h-3 w-3" />
              Este tramo permite promesas de hasta {policy.ptp_max_days} días.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="action-channel">Canal</Label>
        <select
          id="action-channel"
          className={selectClass}
          value={channel}
          onChange={(event) =>
            setChannel(event.target.value as ActionChannelInput)
          }
        >
          {COLLECTION_CHANNELS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="action-notes">
          {requiresReason ? "Motivo" : "Notas"}
        </Label>
        <Textarea
          id="action-notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={
            requiresReason
              ? "Por qué no puede pagar…"
              : "Qué dijo el cliente, a qué hora llamar…"
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="action-status">Estado del deudor</Label>
        <select
          id="action-status"
          className={selectClass}
          value={debtorStatus}
          onChange={(event) => setDebtorStatus(event.target.value)}
        >
          <option value="">No cambiar</option>
          {statusOptions.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          {labelFor(COLLECTION_DEBTOR_STATUSES, "pagado")} lo marca el pago; aquí
          solo se registra el avance de la gestión.
        </p>
      </div>

      {errors.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <Button
        type="submit"
        className="w-full"
        disabled={saving || loadingCatalog}
      >
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Guardar gestión
      </Button>
    </form>
  );
}
