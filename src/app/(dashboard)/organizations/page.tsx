'use client';

// ============================================================
// Empresas (Organizations) — Core CRM, migration 031.
// Lista + búsqueda + CRUD (agent+) con RLS por cuenta.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Organization } from '@/types';
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
  Building2,
  ChevronLeft,
  ChevronRight,
  Globe,
  Mail,
  Phone,
} from 'lucide-react';
import { OrganizationForm } from '@/components/organizations/organization-form';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';

const PAGE_SIZE = 25;

/** Fila cruda de PostgREST con el agregado embebido `contacts(count)`. */
interface OrganizationRow extends Organization {
  contacts?: { count: number }[];
}

export default function OrganizationsPage() {
  const supabase = createClient();
  const canEdit = useCan('send-messages');

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editOrganization, setEditOrganization] = useState<Organization | null>(
    null,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSeq = useRef(0);

  const fetchOrganizations = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();

    let query = supabase
      .from('organizations')
      .select('*, contacts(count)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (term) query = query.ilike('name', `%${term}%`);

    const { data, count, error } = await query;
    if (seq !== fetchSeq.current) return;
    if (error) {
      console.error('[organizations] fetch error:', error);
      toast.error('Error al cargar las empresas');
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as unknown as OrganizationRow[];
    setOrganizations(
      rows.map((r) => ({
        ...r,
        contact_count: r.contacts?.[0]?.count ?? 0,
      })),
    );
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [supabase, page, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchOrganizations();
  }, [fetchOrganizations]);

  function openAddForm() {
    setEditOrganization(null);
    setFormOpen(true);
  }

  function openEditForm(org: Organization) {
    setEditOrganization(org);
    setFormOpen(true);
  }

  function confirmDelete(org: Organization) {
    setDeleteTarget(org);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase
      .from('organizations')
      .delete()
      .eq('id', deleteTarget.id);
    if (error) {
      toast.error('Error al eliminar la empresa');
    } else {
      toast.success('Empresa eliminada');
      fetchOrganizations();
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
          <h1 className="text-2xl font-bold text-foreground">Empresas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestiona las empresas y vincúlalas a tus contactos.
            {totalCount > 0 && ` ${totalCount} empresa${totalCount === 1 ? '' : 's'} en total.`}
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="create companies"
          onClick={openAddForm}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="size-4" />
          Nueva empresa
        </GatedButton>
      </div>

      {/* Search */}
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Buscar empresa por nombre..."
          className="bg-card border-border pl-8 text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Empresa</TableHead>
              <TableHead className="hidden text-muted-foreground md:table-cell">
                Industria
              </TableHead>
              <TableHead className="hidden text-muted-foreground lg:table-cell">
                Contacto
              </TableHead>
              <TableHead className="text-muted-foreground">Contactos</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={5} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">
                      Cargando empresas...
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : organizations.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={5} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Building2 className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {search.trim()
                        ? 'No hay empresas que coincidan con tu búsqueda.'
                        : 'Aún no hay empresas.'}
                    </p>
                    {!search.trim() && (
                      <GatedButton
                        canAct={canEdit}
                        gateReason="create companies"
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="mt-2 border-border text-muted-foreground hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                        Crear tu primera empresa
                      </GatedButton>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              organizations.map((org) => (
                <TableRow
                  key={org.id}
                  className="cursor-pointer border-border hover:bg-muted/50"
                  onClick={() => openEditForm(org)}
                >
                  <TableCell>
                    <div className="font-medium text-foreground">{org.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {org.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3" />
                          {org.phone}
                        </span>
                      )}
                      {org.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="size-3" />
                          {org.email}
                        </span>
                      )}
                      {org.website && (
                        <span className="inline-flex items-center gap-1">
                          <Globe className="size-3" />
                          {org.website}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {org.industry || <span>-</span>}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {org.city || org.country || <span>-</span>}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {org.contact_count ?? 0}
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
                            openEditForm(org);
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
                            confirmDelete(org);
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
      <OrganizationForm
        open={formOpen}
        onOpenChange={setFormOpen}
        organization={editOrganization}
        onSaved={fetchOrganizations}
      />

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Eliminar empresa
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Estás seguro de que quieres eliminar{' '}
              <span className="font-medium text-popover-foreground">
                {deleteTarget?.name}
              </span>
              ? Los contactos vinculados quedarán sin empresa. Esta acción no se
              puede deshacer.
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
