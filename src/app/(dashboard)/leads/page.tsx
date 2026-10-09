'use client';

// ============================================================
// Leads (Prospectos) — Core CRM, migration 032.
// Lista + búsqueda + filtro por estado + CRUD + conversión
// Lead → Contacto/Oferta, con RLS por cuenta.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  LEAD_STATUSES,
  type Lead,
  type LeadStatus,
  type Profile,
} from '@/types';
import { formatCurrency, DEFAULT_CURRENCY } from '@/lib/currency';
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
  Target,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Mail,
  Phone,
  CheckCircle2,
} from 'lucide-react';
import { LeadForm } from '@/components/leads/lead-form';
import { LeadConvertDialog } from '@/components/leads/lead-convert-dialog';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';

const PAGE_SIZE = 25;

/** Colores del chip de estado. */
const STATUS_STYLES: Record<LeadStatus, string> = {
  new: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  contacted: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  qualified: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  unqualified: 'border-border bg-muted text-muted-foreground',
  converted: 'border-primary/40 bg-primary/10 text-primary',
};

export default function LeadsPage() {
  const supabase = createClient();
  const canEdit = useCan('send-messages');

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertLead, setConvertLead] = useState<Lead | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSeq = useRef(0);

  const fetchLeads = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();

    let query = supabase
      .from('leads')
      .select('*, assignee:profiles!leads_assigned_to_fkey(*)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (term) {
      query = query.or(
        `name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%`,
      );
    }

    const { data, count, error } = await query;
    if (seq !== fetchSeq.current) return;
    if (error) {
      console.error('[leads] fetch error:', error);
      toast.error('Error al cargar los leads');
      setLoading(false);
      return;
    }

    setLeads((data ?? []) as unknown as Lead[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [supabase, page, search, statusFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLeads();
  }, [fetchLeads]);

  function openAddForm() {
    setEditLead(null);
    setFormOpen(true);
  }

  function openEditForm(lead: Lead) {
    setEditLead(lead);
    setFormOpen(true);
  }

  function openConvert(lead: Lead) {
    setConvertLead(lead);
    setConvertOpen(true);
  }

  function confirmDelete(lead: Lead) {
    setDeleteTarget(lead);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', deleteTarget.id);
    if (error) {
      toast.error('Error al eliminar el lead');
    } else {
      toast.success('Lead eliminado');
      fetchLeads();
    }
    setDeleting(false);
    setDeleteOpen(false);
    setDeleteTarget(null);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Captura prospectos y conviértelos en contactos y ofertas.
            {totalCount > 0 && ` ${totalCount} lead${totalCount === 1 ? '' : 's'} en total.`}
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="create leads"
          onClick={openAddForm}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="size-4" />
          Nuevo lead
        </GatedButton>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Buscar por nombre, teléfono, correo o empresa..."
            className="bg-card border-border pl-8 text-foreground placeholder:text-muted-foreground"
          />
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
            Todos
          </Button>
          {LEAD_STATUSES.map((s) => (
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
              <TableHead className="text-muted-foreground">Prospecto</TableHead>
              <TableHead className="hidden text-muted-foreground md:table-cell">
                Empresa
              </TableHead>
              <TableHead className="hidden text-muted-foreground lg:table-cell">
                Asignado
              </TableHead>
              <TableHead className="text-muted-foreground">Estado</TableHead>
              <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
                Valor
              </TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={6} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">
                      Cargando leads...
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : leads.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={6} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Target className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {search.trim() || statusFilter !== 'all'
                        ? 'No hay leads que coincidan con el filtro.'
                        : 'Aún no hay leads.'}
                    </p>
                    {!search.trim() && statusFilter === 'all' && (
                      <GatedButton
                        canAct={canEdit}
                        gateReason="create leads"
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="mt-2 border-border text-muted-foreground hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                        Crear tu primer lead
                      </GatedButton>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              leads.map((lead) => (
                <TableRow
                  key={lead.id}
                  className="cursor-pointer border-border hover:bg-muted/50"
                  onClick={() => openEditForm(lead)}
                >
                  <TableCell>
                    <div className="font-medium text-foreground">{lead.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {lead.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3" />
                          {lead.phone}
                        </span>
                      )}
                      {lead.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="size-3" />
                          {lead.email}
                        </span>
                      )}
                      {lead.interest && (
                        <span className="truncate">{lead.interest}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {lead.company || lead.organization?.name || <span>-</span>}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {(lead.assignee as Profile | null)?.full_name || (
                      <span>-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[lead.status] ?? STATUS_STYLES.new
                      }`}
                    >
                      {lead.status === 'converted' && (
                        <CheckCircle2 className="mr-1 size-3" />
                      )}
                      {LEAD_STATUSES.find((s) => s.value === lead.status)?.label ??
                        lead.status}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">
                    {Number(lead.value) > 0
                      ? formatCurrency(
                          Number(lead.value),
                          lead.currency ?? DEFAULT_CURRENCY,
                        )
                      : <span>-</span>}
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
                            openEditForm(lead);
                          }}
                          className="text-popover-foreground focus:bg-muted focus:text-foreground"
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        {lead.status !== 'converted' && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              openConvert(lead);
                            }}
                            className="text-popover-foreground focus:bg-muted focus:text-foreground"
                          >
                            <UserPlus className="size-4" />
                            Convertir
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(lead);
                          }}
                        >
                          <Trash2 className="size-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
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
      <LeadForm
        open={formOpen}
        onOpenChange={setFormOpen}
        lead={editLead}
        onSaved={fetchLeads}
      />

      {/* Convert */}
      <LeadConvertDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        lead={convertLead}
        onConverted={fetchLeads}
      />

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Eliminar lead
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Estás seguro de que quieres eliminar{' '}
              <span className="font-medium text-popover-foreground">
                {deleteTarget?.name}
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
