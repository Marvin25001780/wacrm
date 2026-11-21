"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardList,
  Clock,
  Handshake,
  MessageCircle,
  Phone,
  TrendingUp,
  User,
  Wallet,
} from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { Panel } from "@/components/metrics/panel";
import { ActionForm } from "@/components/collections/action-form";
import { CreditCard } from "@/components/collections/credit-card";
import { PaymentDialog } from "@/components/collections/payment-dialog";
import { PriorityBadge } from "@/components/collections/priority-badge";
import { useTelephony } from "@/components/telephony/telephony-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadMemberOptions, type MemberOption } from "@/lib/account/members";
import {
  DEBTOR_STATUS_TONE,
  PROMISE_STATUS_TONE,
  SEGMENT_TONE,
  daysOverdue,
  formatDate,
  formatUsd,
  installmentBalance,
  todayIso,
} from "@/lib/collections/format";
import {
  COLLECTION_CHANNELS,
  COLLECTION_DEBTOR_STATUSES,
  COLLECTION_PAYMENT_METHODS,
  COLLECTION_PROMISE_STATUSES,
  COLLECTION_SEGMENTS,
  labelFor,
  type CollectionAction,
  type CollectionCredit,
  type CollectionDebtor,
  type CollectionInstallment,
  type CollectionOutcome,
  type CollectionPayment,
  type CollectionPromise,
} from "@/types/collections";
import { cn } from "@/lib/utils";

export default function DebtorDetailPage() {
  const supabase = createClient();
  const { accountId, accountRole } = useAuth();
  const isAdmin = accountRole === "admin" || accountRole === "owner";
  const { startCall, callable } = useTelephony();
  const params = useParams();
  const debtorId = typeof params.id === "string" ? params.id : params.id?.[0];

  const [debtor, setDebtor] = useState<CollectionDebtor | null>(null);
  const [credits, setCredits] = useState<CollectionCredit[]>([]);
  const [installments, setInstallments] = useState<CollectionInstallment[]>([]);
  const [payments, setPayments] = useState<CollectionPayment[]>([]);
  const [promises, setPromises] = useState<CollectionPromise[]>([]);
  const [actions, setActions] = useState<CollectionAction[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<Record<string, string>>({});
  const [assignable, setAssignable] = useState<MemberOption[]>([]);
  const [assignee, setAssignee] = useState<{ user_id: string; name: string } | null>(null);
  const [assignTarget, setAssignTarget] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [loading, setLoading] = useState(true);

  const [paying, setPaying] = useState<CollectionInstallment | null>(null);
  const [busyPromise, setBusyPromise] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);

  const load = useCallback(async () => {
    if (!debtorId) return;
    setLoading(true);

    const [
      debtorRes,
      creditsRes,
      installmentsRes,
      paymentsRes,
      promisesRes,
      actionsRes,
      outcomesRes,
      assigneeRes,
    ] = await Promise.all([
      supabase.from("collection_debtors").select("*").eq("id", debtorId).maybeSingle(),
      supabase
        .from("collection_credits")
        .select("*")
        .eq("debtor_id", debtorId)
        .order("created_at", { ascending: true }),
      supabase
        .from("collection_installments")
        .select("*")
        .eq("debtor_id", debtorId)
        .order("due_date", { ascending: true }),
      supabase
        .from("collection_payments")
        .select("*")
        .eq("debtor_id", debtorId)
        .order("paid_at", { ascending: false }),
      supabase
        .from("collection_promises")
        .select("*")
        .eq("debtor_id", debtorId)
        .order("due_date", { ascending: true }),
      supabase
        .from("collection_actions")
        .select("*")
        .eq("debtor_id", debtorId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.from("collection_outcomes").select("code, label, account_id"),
      // 126: nombre del gestor asignado, aunque `profiles` solo deje
      // ver el perfil propio. Si la migración falta, la ficha sigue.
      supabase.rpc("collection_debtor_assignee", { p_debtor_id: debtorId }),
    ]);

    // El equipo se resuelve por RPC (109/110): `profiles` bajo RLS
    // solo devuelve el perfil propio y el resto salía como "Usuario".
    const options = await loadMemberOptions(supabase).catch(() => []);
    const nameMap: Record<string, string> = {};
    for (const option of options) nameMap[option.user_id] = option.name;
    setMembers(nameMap);
    setAssignable(options.filter((option) => option.role !== "viewer"));

    const assigneeRow = Array.isArray(assigneeRes.data)
      ? assigneeRes.data[0]
      : assigneeRes.data;

    setAssignee(
      assigneeRow?.user_id
        ? { user_id: assigneeRow.user_id, name: assigneeRow.name ?? "Gestor" }
        : null
    );
    setAssignTarget(assigneeRow?.user_id ?? "");

    setLoading(false);

    if (debtorRes.error) {
      console.error("[cobranza/debtor] load error", debtorRes.error);
      toast.error("No se pudo cargar la ficha del deudor");
      return;
    }

    setDebtor((debtorRes.data ?? null) as CollectionDebtor | null);
    setCredits((creditsRes.data ?? []) as CollectionCredit[]);
    setInstallments((installmentsRes.data ?? []) as CollectionInstallment[]);
    setPayments((paymentsRes.data ?? []) as CollectionPayment[]);
    setPromises((promisesRes.data ?? []) as CollectionPromise[]);
    setActions((actionsRes.data ?? []) as CollectionAction[]);

    const outcomeMap: Record<string, string> = {};
    for (const outcome of (outcomesRes.data ?? []) as CollectionOutcome[]) {
      if (outcome.account_id || !outcomeMap[outcome.code]) {
        outcomeMap[outcome.code] = outcome.label;
      }
    }
    setOutcomes(outcomeMap);
  }, [debtorId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, accountId]);

  const summary = useMemo(() => {
    const today = todayIso();
    const open = installments.filter(
      (installment) => installment.status === "pending" || installment.status === "partial",
    );

    return {
      balance: open.reduce((sum, installment) => sum + installmentBalance(installment), 0),
      overdue: open
        .filter((installment) => installment.due_date < today)
        .reduce((sum, installment) => sum + installmentBalance(installment), 0),
      paid: installments.reduce(
        (sum, installment) => sum + Number(installment.paid_amount || 0),
        0,
      ),
      pendingPromises: promises.filter(
        (promise) => promise.status === "pending" || promise.status === "partial",
      ).length,
      days: open.reduce(
        (max, installment) => Math.max(max, daysOverdue(installment.due_date)),
        0,
      ),
    };
  }, [installments, promises]);

  async function resolvePromise(promiseId: string, status: "kept" | "broken" | "cancelled") {
    setBusyPromise(promiseId);
    try {
      const response = await fetch(`/api/cobranza/promises/${promiseId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "No se pudo actualizar la PTP.");
      toast.success("PTP actualizada");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar la PTP.");
    } finally {
      setBusyPromise(null);
    }
  }

  async function handleAssign() {
    if (!debtorId) return;
    setAssigning(true);
    try {
      const response = await fetch(`/api/cobranza/debtors/${debtorId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: assignTarget || null }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        agentName?: string;
        released?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(json.error ?? "No se pudo reasignar el deudor.");
      }
      toast.success(
        json.agentName
          ? `Asignado a ${json.agentName}`
          : "Deudor devuelto a la cola sin asignar"
      );
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo reasignar el deudor."
      );
    } finally {
      setAssigning(false);
    }
  }

  const selectClass =
    "h-8 max-w-[190px] rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonCard className="h-28" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
        <SkeletonCard className="h-72" />
      </div>
    );
  }

  if (!debtor) {
    return (
      <div className="space-y-4">
        <Link
          href="/cobranza/cartera"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a la cartera
        </Link>
        <EmptyState
          icon={User}
          title="Deudor no encontrado"
          hint="Puede que se haya eliminado o que no pertenezca a esta cuenta."
        />
      </div>
    );
  }

  const phone = debtor.phone_primary?.replace(/[^\d+]/g, "") ?? "";
  const whatsapp = debtor.phone_primary?.replace(/\D/g, "") ?? "";
  const installmentById = new Map(installments.map((installment) => [installment.id, installment]));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/cobranza/cartera"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a la cartera
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">{debtor.name}</h1>
              <span
                className={cn(
                  "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                  SEGMENT_TONE[debtor.segment],
                )}
              >
                {labelFor(COLLECTION_SEGMENTS, debtor.segment)}
              </span>
              <span
                className={cn(
                  "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                  DEBTOR_STATUS_TONE[debtor.status],
                )}
              >
                {labelFor(COLLECTION_DEBTOR_STATUSES, debtor.status)}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>{debtor.document_number ?? "Sin documento"}</span>
              {debtor.phone_primary ? <span>{debtor.phone_primary}</span> : null}
              {debtor.email ? <span>{debtor.email}</span> : null}
              {debtor.city ? <span>{debtor.city}</span> : null}
            </div>

            {debtor.address ? (
              <p className="mt-1 text-sm text-muted-foreground">{debtor.address}</p>
            ) : null}
          </div>

          <div className="flex flex-col items-end gap-2">
            <PriorityBadge
              score={debtor.priority_score}
              reason={debtor.priority_reason}
              showReason
            />
            <div className="flex flex-wrap justify-end gap-2">
              {phone ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!callable}
                  title={callable ? "Marcar por el softphone" : "El softphone no está configurado"}
                  onClick={() =>
                    void startCall(phone, { collectionDebtorId: debtor.id })
                  }
                >
                  <Phone className="mr-1.5 h-4 w-4" />
                  Llamar
                </Button>
              ) : null}
              <Button type="button" size="sm" onClick={() => setManaging(true)}>
                <ClipboardList className="mr-1.5 h-4 w-4" />
                Gestionar
              </Button>
              <Link
                href="/cobranza/consola"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Consola
              </Link>
              {whatsapp ? (
                <a
                  href={`https://wa.me/${whatsapp}`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <MessageCircle className="mr-1.5 h-4 w-4" />
                  WhatsApp
                </a>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1">
              <p className="text-xs text-muted-foreground">
                Gestor: {assignee?.name ?? "Sin asignar"}
              </p>
              {isAdmin ? (
                <div className="flex items-center gap-1.5">
                  <select
                    className={selectClass}
                    value={assignTarget}
                    onChange={(event) => setAssignTarget(event.target.value)}
                    aria-label="Asignar deudor a un gestor"
                  >
                    <option value="">Sin asignar</option>
                    {assignable.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleAssign()}
                    disabled={
                      assigning ||
                      assignTarget === (assignee?.user_id ?? "")
                    }
                  >
                    {assigning ? "Guardando…" : "Asignar"}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Saldo total"
          value={formatUsd(summary.balance)}
          icon={Wallet}
          subtitle="Cuotas abiertas"
        />
        <MetricCard
          title="Saldo vencido"
          value={formatUsd(summary.overdue)}
          icon={AlertTriangle}
          subtitle={summary.days > 0 ? `Mora máxima ${summary.days}d` : "Sin mora"}
        />
        <MetricCard
          title="Pagado"
          value={formatUsd(summary.paid)}
          icon={TrendingUp}
          subtitle="Acumulado del deudor"
        />
        <MetricCard
          title="PTP abiertas"
          value={String(summary.pendingPromises)}
          icon={Handshake}
          subtitle="Acuerdos pendientes"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {credits.length === 0 ? (
            <EmptyState icon={Wallet} title="Sin créditos registrados" />
          ) : (
            credits.map((credit) => (
              <CreditCard
                key={credit.id}
                credit={credit}
                installments={installments.filter(
                  (installment) => installment.credit_id === credit.id,
                )}
                onPay={setPaying}
              />
            ))
          )}

          <Panel title="Historial de pagos" subtitle="Pagos registrados contra este deudor">
            {payments.length === 0 ? (
              <EmptyState icon={Wallet} title="Sin pagos registrados" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cuota</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Referencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => {
                    const installment = installmentById.get(payment.installment_id);
                    return (
                      <TableRow key={payment.id}>
                        <TableCell>{formatDate(payment.paid_at)}</TableCell>
                        <TableCell>
                          {installment ? `Cuota ${installment.number}` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-300">
                          {formatUsd(payment.amount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {labelFor(COLLECTION_PAYMENT_METHODS, payment.method)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {payment.reference ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Acuerdos de pago" subtitle="PTP del deudor">
            {promises.length === 0 ? (
              <EmptyState icon={Handshake} title="Sin acuerdos" />
            ) : (
              <div className="space-y-3">
                {promises.map((promise) => {
                  const open = promise.status === "pending" || promise.status === "partial";
                  return (
                    <div key={promise.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold tabular-nums">
                            {formatUsd(promise.amount)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Vence {formatDate(promise.due_date)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                            PROMISE_STATUS_TONE[promise.status],
                          )}
                        >
                          {labelFor(COLLECTION_PROMISE_STATUSES, promise.status)}
                        </span>
                      </div>
                      {promise.paid_amount > 0 ? (
                        <p className="mt-1 text-xs text-emerald-300">
                          Pagado {formatUsd(promise.paid_amount)}
                        </p>
                      ) : null}
                      {open ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={busyPromise === promise.id}
                            onClick={() => resolvePromise(promise.id, "kept")}
                          >
                            Cumplida
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={busyPromise === promise.id}
                            onClick={() => resolvePromise(promise.id, "broken")}
                          >
                            Rota
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={busyPromise === promise.id}
                            onClick={() => resolvePromise(promise.id, "cancelled")}
                          >
                            Cancelar
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="Gestiones" subtitle="Últimas 20 gestiones">
            {actions.length === 0 ? (
              <EmptyState icon={Clock} title="Sin gestiones registradas" />
            ) : (
              <div className="space-y-3">
                {actions.map((action) => (
                  <div key={action.id} className="border-l-2 border-border pl-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {labelFor(COLLECTION_CHANNELS, action.channel)}
                      </span>
                      <span>{formatDate(action.created_at.slice(0, 10))}</span>
                      {members[action.user_id] ? <span>{members[action.user_id]}</span> : null}
                    </div>
                    <p className="mt-1 text-sm text-foreground">
                      {outcomes[action.level1_code] ?? action.level1_code}
                      {action.level2_code
                        ? ` · ${outcomes[action.level2_code] ?? action.level2_code}`
                        : ""}
                    </p>
                    {action.notes ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{action.notes}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Dialog open={managing} onOpenChange={setManaging}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar gestión</DialogTitle>
            <DialogDescription>
              {debtor.name}
              {debtor.phone_primary ? ` · ${debtor.phone_primary}` : ""}
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            debtorId={debtor.id}
            debtorName={debtor.name}
            daysOverdue={summary.days}
            overdueBalance={summary.overdue}
            balance={summary.balance}
            isAdmin={isAdmin}
            accountId={accountId}
            onSaved={() => {
              setManaging(false);
              void load();
            }}
          />
        </DialogContent>
      </Dialog>

      <PaymentDialog
        installment={paying}
        open={Boolean(paying)}
        onOpenChange={(open) => !open && setPaying(null)}
        onSaved={load}
      />
    </div>
  );
}
