'use client';

// ============================================================
// Actividades (Activities) — Core CRM, migration 033.
// Lista + filtros + CRUD + completar rápido, con RLS por cuenta.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ACTIVITY_STATUSES,
  ACTIVITY_TYPES,
  activityTypeLabel,
  type Activity,
  type ActivityStatus,
  type Profile,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Circle,
  RotateCcw,
  Flame,
} from 'lucide-react';
import { ActivityForm } from '@/components/activities/activity-form';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';

const PAGE_SIZE = 25;

const STATUS_STYLES: Record<ActivityStatus, string> = {
  pending: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  done: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  cancelled: 'border-border bg-muted text-muted-foreground',
};

const PRIORITY_STYLES: Record<string, string> = {
  low: 'text-muted-foreground',
  medium: 'text-amber-300',
  high: 'text-red-400',
};

export default function ActivitiesPage() {
  const supabase = createClient();
  const canEdit = useCan('send-messages');

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editActivity, setEditActivity] = useState<Activity | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const fetchSeq = useRef(0);

  const fetchActivities = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();

    let query = supabase
      .from('activities')
      .select(
        '*, assignee:profiles!activities_assigned_to_fkey(*), contact:contacts!activities_contact_id_fkey(id,name,phone), lead:leads!activities_lead_id_fkey(id,name), organization:organizations!activities_organization_id_fkey(id,name), deal:deals!activities_deal_id_fkey(id,title)',
        { count: 'exact' },
      )
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (typeFilter !== 'all') query = query.eq('type', typeFilter);
    if (term) {
      query = query.or(`subject.ilike.%${term}%,description.ilike.%${term}%`);
    }

    const { data, count, error } = await query;
    if (seq !== fetchSeq.current) return;
    if (error) {
      console.error('[activities] fetch error:', error);
      toast.error('Error al cargar las actividades');
      setLoading(false);
      return;
    }

    setActivities((data ?? []) as unknown as Activity[]);
    setTotalCount(count ?? 0);
    setNow(Date.now());
    setLoading(false);
  }, [supabase, page, search, statusFilter, typeFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchActivities();
  }, [fetchActivities]);

  function openAddForm() {
    setEditActivity(null);
    setFormOpen(true);
  }

  function openEditForm(activity: Activity) {
    setEditActivity(activity);
    setFormOpen(true);
  }

  function confirmDelete(activity: Activity) {
    setDeleteTarget(activity);
    setDeleteOpen(true);
  }

  async function toggleComplete(activity: Activity) {
    if (activity.status === 'done') {
      setBusyId(activity.id);
      const { error } = await supabase
        .from('activities')
        .update({ status: 'pending', completed_at: null })
        .eq('id', activity.id);
      setBusyId(null);
      if (error) {
        toast.error('Error al reabrir la actividad');
      } else {
        toast.success('Actividad reabierta');
        fetchActivities();
      }
      return;
    }
    setBusyId(activity.id);
    const { error } = await supabase
      .from('activities')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', activity.id);
    setBusyId(null);
    if (error) {
      toast.error('Error al completar la actividad');
    } else {
      toast.success('Actividad completada');
      fetchActivities();
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase
      .from('activities')
      .delete()
      .eq('id', deleteTarget.id);
    if (error) {
      toast.error('Error al eliminar la actividad');
    } else {
      toast.success('Actividad eliminada');
      fetchActivities();
    }
    setDeleting(false);
    setDeleteOpen(false);
    setDeleteTarget(null);
  }

  function linkLabel(a: Activity): string {
    if (a.contact) return a.contact.name || a.contact.phone || '';
    if (a.lead) return a.lead.name;
    if (a.organization) return a.organization.name;
    if (a.deal) return a.deal.title;
    return '';
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Actividades</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Programa llamadas, reuniones y tareas ligadas a tu CRM.
            {totalCount > 0 && ` ${totalCount} actividad${totalCount === 1 ? '' : 'es'} en total.`}
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="create activities"
          onClick={openAddForm}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="size-4" />
          Nueva actividad
        </GatedButton>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Buscar actividad..."
              className="bg-card border-border pl-8 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(0);
            }}
            className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="all">Todos los tipos</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant={statusFilter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              setStatusFilter('all');
              setPage(0);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            Todas
          </Button>
          {ACTIVITY_STATUSES.map((s) => (
            <Button
              key={s.value}
              variant={statusFilter === s.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setStatusFilter(s.value);
                setPage(0);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-10" />
              <TableHead className="text-muted-foreground">Actividad</TableHead>
              <TableHead className="hidden text-muted-foreground md:table-cell">
                Vínculo
              </TableHead>
              <TableHead className="text-muted-foreground">Fecha</TableHead>
              <TableHead className="hidden text-muted-foreground lg:table-cell">
                Asignado
              </TableHead>
              <TableHead className="text-muted-foreground">Estado</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={7} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">
                      Cargando actividades...
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : activities.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={7} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <CalendarCheck className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {search.trim() || statusFilter !== 'all' || typeFilter !== 'all'
                        ? 'No hay actividades que coincidan con el filtro.'
                        : 'Aún no hay actividades.'}
                    </p>
                    {!search.trim() && statusFilter === 'all' && typeFilter === 'all' && (
                      <GatedButton
                        canAct={canEdit}
                        gateReason="create activities"
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="mt-2 border-border text-muted-foreground hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                        Crear tu primera actividad
                      </GatedButton>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              activities.map((a) => {
                const overdue =
                  a.status === 'pending' &&
                  !!a.due_at &&
                  new Date(a.due_at).getTime() < now;
                return (
                  <TableRow
                    key={a.id}
                    className="cursor-pointer border-border hover:bg-muted/50"
                    onClick={() => openEditForm(a)}
                  >
                    <TableCell>
                      <button
                        type="button"
                        disabled={!canEdit || busyId === a.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleComplete(a);
                        }}
                        title={
                          a.status === 'done'
                            ? 'Reabrir'
                            : 'Marcar como completada'
                        }
                        className="text-muted-foreground transition-colors hover:text-emerald-400 disabled:opacity-40"
                      >
                        {busyId === a.id ? (
                          <Loader2 className="size-5 animate-spin" />
                        ) : a.status === 'done' ? (
                          <CheckCircle2 className="size-5 text-emerald-400" />
                        ) : (
                          <Circle className="size-5" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium ${
                            a.status === 'done' || a.status === 'cancelled'
                              ? 'text-muted-foreground line-through'
                              : 'text-foreground'
                          }`}
                        >
                          {a.subject}
                        </span>
                        {a.priority === 'high' && a.status === 'pending' && (
                          <Flame className="size-3.5 text-red-400" />
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{activityTypeLabel(a.type)}</span>
                        {a.priority !== 'medium' && (
                          <span className={PRIORITY_STYLES[a.priority]}>
                            Prioridad {a.priority === 'high' ? 'alta' : 'baja'}
                          </span>
                        )}
                        {a.description && (
                          <span className="truncate">{a.description}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {linkLabel(a) || <span>-</span>}
                    </TableCell>
                    <TableCell>
                      {a.due_at ? (
                        <span
                          className={
                            overdue
                              ? 'text-sm font-medium text-red-400'
                              : 'text-sm text-muted-foreground'
                          }
                        >
                          {format(new Date(a.due_at), "d MMM yyyy, HH:mm", {
                            locale: es,
                          })}
                          {overdue && ' · vencida'}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {(a.assignee as Profile | null)?.full_name || <span>-</span>}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[a.status] ?? STATUS_STYLES.pending
                        }`}
                      >
                        {ACTIVITY_STATUSES.find((s) => s.value === a.status)?.label ??
                          a.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={(e) => e.stopPropagation()}
                            />
                          }
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="bg-popover border-border"
                        >
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleComplete(a);
                            }}
                            className="text-popover-foreground focus:bg-muted focus:text-foreground"
                          >
                            {a.status === 'done' ? (
                              <>
                                <RotateCcw className="size-4" />
                                Reabrir
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="size-4" />
                                Completar
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditForm(a);
                            }}
                            className="text-popover-foreground focus:bg-muted focus:text-foreground"
                          >
                            <Pencil className="size-4" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-border" />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              confirmDelete(a);
                            }}
                          >
                            <Trash2 className="size-4" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Mostrando {page * PAGE_SIZE + 1}-
            {Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="px-2 text-xs text-muted-foreground">
              Página {page + 1} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Form */}
      <ActivityForm
        open={formOpen}
        onOpenChange={setFormOpen}
        activity={editActivity}
        onSaved={fetchActivities}
      />

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Eliminar actividad
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Estás seguro de que quieres eliminar{' '}
              <span className="font-medium text-popover-foreground">
                {deleteTarget?.subject}
              </span>
              ? Esta acción no se puede deshacer.
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
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
