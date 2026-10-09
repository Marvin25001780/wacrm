'use client';

// ============================================================
// Cobranza — cuentas por cobrar (módulo 2.2, migration 037).
// Resumen (por cobrar / vencido / cobrado), filtros, búsqueda.
// Cada fila se expande para ver y registrar ABONOS. Alta/edición
// y borrado, RLS por cuenta.
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { toast } from 'sonner';
import {
  paymentMethodLabel,
  type Receivable,
  type ReceivableStatus,
} from '@/types';
import { formatCurrency } from '@/lib/currency';
import {
  paymentTotal,
  receivableBalance,
  receivableEffectiveStatus,
  isReceivableOverdue,
  todayIso,
} from '@/lib/receivables/utils';
import { ReceivableForm } from '@/components/receivables/receivable-form';
import { PaymentForm } from '@/components/receivables/payment-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Plus,
  Search,
  Loader2,
  ChevronRight,
  Pencil,
  Trash2,
  X,
  HandCoins,
  Wallet,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';

type FilterKey = 'all' | 'pending' | 'overdue' | 'paid';

interface Row extends Receivable {
  _status: ReceivableStatus;
  _balance: number;
  _paid: number;
  _overdue: boolean;
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'overdue', label: 'Vencidas' },
  { key: 'paid', label: 'Pagadas' },
];

const STATUS_BADGE: Record<ReceivableStatus, string> = {
  pending: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  partial: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  paid: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  cancelled: 'border-border bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<ReceivableStatus, string> = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagada',
  cancelled: 'Anulada',
};

export default function ReceivablesPage() {
  const supabase = createClient();
  const { defaultCurrency } = useAuth();
  const canEdit = useCan('send-messages');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Receivable | null>(null);

  const [paying, setPaying] = useState<Receivable | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Receivable | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchReceivables = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('receivables')
      .select(
        '*, contact:contacts(*), organization:organizations(*), payments:receivable_payments(*)',
      )
      .order('created_at', { ascending: false });
    setLoading(false);

    if (error) {
      console.error('[receivables] fetch error:', error);
      toast.error('Error al cargar las cuentas por cobrar');
      return;
    }

    const today = todayIso();
    const data2 = (data ?? []) as unknown as Receivable[];
    setRows(
      data2.map((r) => ({
        ...r,
        _status: receivableEffectiveStatus(r),
        _balance: receivableBalance(r),
        _paid: paymentTotal(r),
        _overdue: isReceivableOverdue(r, today),
      })),
    );
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchReceivables();
  }, [fetchReceivables]);

  const summary = useMemo(() => {
    const active = rows.filter((r) => r._status !== 'cancelled');
    return {
      receivable: active.reduce((s, r) => s + r._balance, 0),
      overdue: active.filter((r) => r._overdue).reduce((s, r) => s + r._balance, 0),
      collected: rows.reduce((s, r) => s + r._paid, 0),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (filter === 'pending') list = list.filter((r) => r._status === 'pending' || r._status === 'partial');
    else if (filter === 'overdue') list = list.filter((r) => r._overdue);
    else if (filter === 'paid') list = list.filter((r) => r._status === 'paid');

    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(
        (r) =>
          r.concept.toLowerCase().includes(term) ||
          (r.contact?.name ?? '').toLowerCase().includes(term) ||
          (r.organization?.name ?? '').toLowerCase().includes(term),
      );
    }
    return list;
  }, [rows, filter, search]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(r: Receivable) {
    setEditing(r);
    setFormOpen(true);
  }

  function confirmDelete(r: Receivable) {
    setDeleteTarget(r);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('receivables').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) {
      toast.error('Error al eliminar la cuenta');
      return;
    }
    toast.success('Cuenta eliminada');
    setDeleteOpen(false);
    setDeleteTarget(null);
    fetchReceivables();
  }

  async function handleDeletePayment(paymentId: string) {
    const { error } = await supabase.from('receivable_payments').delete().eq('id', paymentId);
    if (error) {
      toast.error('Error al eliminar el abono');
      return;
    }
    toast.success('Abono eliminado');
    fetchReceivables();
  }

  function statusBadge(r: Row) {
    if (r._overdue) {
      return { label: 'Vencida', className: 'border-rose-500/40 bg-rose-500/10 text-rose-300' };
    }
    return { label: STATUS_LABEL[r._status], className: STATUS_BADGE[r._status] };
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cobranza</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuentas por cobrar, abonos y vencimientos.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={openCreate}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            Nueva cuenta
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={<Wallet className="size-4" />}
          label="Por cobrar"
          value={formatCurrency(summary.receivable, defaultCurrency)}
          tone="text-foreground"
        />
        <SummaryCard
          icon={<AlertTriangle className="size-4" />}
          label="Vencido"
          value={formatCurrency(summary.overdue, defaultCurrency)}
          tone="text-rose-400"
        />
        <SummaryCard
          icon={<TrendingUp className="size-4" />}
          label="Cobrado"
          value={formatCurrency(summary.collected, defaultCurrency)}
          tone="text-emerald-400"
        />
      </div>

      {/* Filters + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                (filter === f.key
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground hover:text-foreground')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por concepto o cliente..."
            className="bg-card border-border pl-8 text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col items-center gap-2 py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Cargando cuentas...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16">
          <HandCoins className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? 'Aún no hay cuentas por cobrar.' : 'No hay cuentas que coincidan.'}
          </p>
          {rows.length === 0 && canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={openCreate}
              className="mt-2 border-border text-muted-foreground hover:bg-muted"
            >
              <Plus className="size-3.5" />
              Crear la primera
            </Button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {filtered.map((r) => {
            const badge = statusBadge(r);
            const isOpen = expanded.has(r.id);
            const payments = r.payments ?? [];
            const client = r.contact?.name || r.organization?.name || 'Sin cliente';
            return (
              <div key={r.id}>
                {/* Row */}
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(r.id)}
                    className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                  >
                    <ChevronRight
                      className={
                        'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ' +
                        (isOpen ? 'rotate-90' : '')
                      }
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{r.concept}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {client}
                        {r.due_date ? ` · vence ${r.due_date}` : ''}
                        {payments.length > 0 ? ` · ${payments.length} abono(s)` : ''}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-4 pl-6 sm:pl-0">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrency(r._balance, r.currency)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        de {formatCurrency(r.amount, r.currency)}
                      </p>
                    </div>
                    <span
                      className={
                        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ' +
                        badge.className
                      }
                    >
                      {badge.label}
                    </span>

                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-1">
                        {r._status !== 'cancelled' && r._balance > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPaying(r)}
                            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <HandCoins className="size-3.5" />
                            Abono
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEdit(r)}
                          title="Editar"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => confirmDelete(r)}
                          title="Eliminar"
                          className="text-muted-foreground hover:text-rose-400"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded payments */}
                {isOpen && (
                  <div className="border-t border-border bg-muted/30 px-4 py-3 sm:pl-11">
                    {r.notes && (
                      <p className="mb-3 text-xs text-muted-foreground">{r.notes}</p>
                    )}
                    {payments.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sin abonos registrados.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {payments
                          .slice()
                          .sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1))
                          .map((p) => (
                            <li
                              key={p.id}
                              className="flex items-center justify-between gap-3 text-sm"
                            >
                              <span className="inline-flex min-w-0 items-center gap-2 text-foreground">
                                <span className="font-medium">
                                  {formatCurrency(Number(p.amount), r.currency)}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                  {p.paid_at}
                                  {p.method ? ` · ${paymentMethodLabel(p.method)}` : ''}
                                  {p.reference ? ` · ${p.reference}` : ''}
                                </span>
                              </span>
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => handleDeletePayment(p.id)}
                                  title="Eliminar abono"
                                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-rose-400"
                                >
                                  <X className="size-3.5" />
                                </button>
                              )}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Forms */}
      <ReceivableForm
        open={formOpen}
        onOpenChange={setFormOpen}
        receivable={editing}
        onSaved={fetchReceivables}
      />

      {paying && (
        <PaymentForm
          open={!!paying}
          onOpenChange={(o) => {
            if (!o) setPaying(null);
          }}
          receivable={paying}
          onSaved={() => {
            setPaying(null);
            fetchReceivables();
          }}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Eliminar cuenta</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Eliminar{' '}
              <span className="font-medium text-popover-foreground">{deleteTarget?.concept}</span>?
              Se borrarán también sus abonos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}
