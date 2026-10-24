"use client";

import { CreditCard as CreditCardIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  COLLECTION_CREDIT_STATUSES,
  COLLECTION_INSTALLMENT_STATUSES,
  labelFor,
  type CollectionCredit,
  type CollectionInstallment,
} from "@/types/collections";
import {
  INSTALLMENT_STATUS_TONE,
  daysOverdue,
  formatDate,
  formatUsd,
  installmentBalance,
} from "@/lib/collections/format";
import { cn } from "@/lib/utils";

interface CreditCardProps {
  credit: CollectionCredit;
  installments: CollectionInstallment[];
  onPay: (installment: CollectionInstallment) => void;
}

export function CreditCard({ credit, installments, onPay }: CreditCardProps) {
  const paid = installments.reduce(
    (sum, installment) => sum + (Number(installment.paid_amount) || 0),
    0,
  );
  const balance = Math.max(0, (Number(credit.total) || 0) - paid);

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <CreditCardIcon className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Crédito {credit.folio}</h3>
              <span className="inline-flex rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {labelFor(COLLECTION_CREDIT_STATUSES, credit.status)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {credit.product ?? "Sin producto"} · {installments.length} cuota
              {installments.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 text-right">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-sm font-semibold tabular-nums">{formatUsd(credit.total)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pagado</p>
            <p className="text-sm font-semibold tabular-nums text-emerald-300">{formatUsd(paid)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Saldo</p>
            <p className="text-sm font-semibold tabular-nums text-amber-300">{formatUsd(balance)}</p>
          </div>
        </div>
      </header>

      <div className="p-2 sm:p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Cuota</TableHead>
              <TableHead>Vence</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Pagado</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {installments.map((installment) => {
              const remaining = installmentBalance(installment);
              const overdue = daysOverdue(installment.due_date);

              return (
                <TableRow key={installment.id}>
                  <TableCell className="tabular-nums">{installment.number}</TableCell>
                  <TableCell>
                    <span className={overdue > 0 ? "text-red-300" : "text-foreground"}>
                      {formatDate(installment.due_date)}
                    </span>
                    {overdue > 0 && installment.status !== "paid" ? (
                      <span className="ml-2 text-xs text-red-300">{overdue}d</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(installment.total)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-300">
                    {formatUsd(installment.paid_amount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(remaining)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                        INSTALLMENT_STATUS_TONE[installment.status],
                      )}
                    >
                      {labelFor(COLLECTION_INSTALLMENT_STATUSES, installment.status)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {remaining > 0 && installment.status !== "cancelled" ? (
                      <Button size="sm" variant="outline" onClick={() => onPay(installment)}>
                        Abonar
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
