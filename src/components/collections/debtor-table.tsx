"use client";

import Link from "next/link";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  COLLECTION_DEBTOR_STATUSES,
  COLLECTION_SEGMENTS,
  labelFor,
  type CollectionDebtorSummary,
} from "@/types/collections";
import {
  DEBTOR_STATUS_TONE,
  SEGMENT_TONE,
  formatDate,
  formatUsd,
} from "@/lib/collections/format";
import { cn } from "@/lib/utils";
import { PriorityBadge } from "./priority-badge";

interface DebtorTableProps {
  rows: CollectionDebtorSummary[];
  loading?: boolean;
  assigneeNames?: Record<string, string>;
}

export function DebtorTable({ rows, loading, assigneeNames = {} }: DebtorTableProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sin deudores en cartera"
        hint="Carga un archivo Excel o CSV para empezar a gestionar la cobranza."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Deudor</TableHead>
          <TableHead>Segmento</TableHead>
          <TableHead>Prioridad</TableHead>
          <TableHead className="text-right">Saldo</TableHead>
          <TableHead className="text-right">Vencido</TableHead>
          <TableHead className="text-right">Mora</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Gestor</TableHead>
          <TableHead>Última gestión</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((debtor) => (
          <TableRow key={debtor.id}>
            <TableCell>
              <Link
                href={`/cobranza/cartera/${debtor.id}`}
                className="font-medium text-foreground hover:text-primary"
              >
                {debtor.name}
              </Link>
              <div className="text-xs text-muted-foreground">
                {debtor.document_number ?? "Sin documento"}
                {debtor.phone_primary ? ` · ${debtor.phone_primary}` : ""}
              </div>
            </TableCell>
            <TableCell>
              <span
                className={cn(
                  "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                  SEGMENT_TONE[debtor.segment],
                )}
              >
                {labelFor(COLLECTION_SEGMENTS, debtor.segment)}
              </span>
            </TableCell>
            <TableCell>
              <PriorityBadge score={debtor.priority_score} reason={debtor.priority_reason} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatUsd(debtor.balance)}</TableCell>
            <TableCell className="text-right tabular-nums text-amber-300">
              {formatUsd(debtor.overdue_balance)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {debtor.days_overdue_max > 0 ? `${debtor.days_overdue_max}d` : "—"}
            </TableCell>
            <TableCell>
              <span
                className={cn(
                  "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                  DEBTOR_STATUS_TONE[debtor.status],
                )}
              >
                {labelFor(COLLECTION_DEBTOR_STATUSES, debtor.status)}
              </span>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {debtor.assigned_to ? (assigneeNames[debtor.assigned_to] ?? "Asignado") : "Sin asignar"}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatDate(debtor.last_action_at?.slice(0, 10))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
