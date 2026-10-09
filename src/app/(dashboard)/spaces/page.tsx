'use client';

// ============================================================
// Espacios de trabajo (Spaces) — módulo 2.1, migration 036.
// Lista de espacios con nombre/color, nº de miembros y registros.
// Alta/edición + borrado, RLS por cuenta.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { type Space } from '@/types';
import { spaceColor } from '@/lib/spaces/colors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  FolderKanban,
  Users,
  Link2,
} from 'lucide-react';
import { SpaceForm } from '@/components/spaces/space-form';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';

interface SpaceWithCounts extends Space {
  member_count: number;
  record_count: number;
}

export default function SpacesPage() {
  const supabase = createClient();
  const canEdit = useCan('send-messages');

  const [spaces, setSpaces] = useState<SpaceWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Space | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Space | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSeq = useRef(0);

  const fetchSpaces = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);

    const { data, error } = await supabase
      .from('spaces')
      .select('*, members:space_members(count), records:space_records(count)')
      .order('created_at', { ascending: false });

    if (seq !== fetchSeq.current) return;
    setLoading(false);

    if (error) {
      console.error('[spaces] fetch error:', error);
      toast.error('Error al cargar los espacios');
      return;
    }

    const rows = (data ?? []) as unknown as Array<
      Space & { members?: { count: number }[]; records?: { count: number }[] }
    >;
    setSpaces(
      rows.map((r) => ({
        ...r,
        member_count: r.members?.[0]?.count ?? 0,
        record_count: r.records?.[0]?.count ?? 0,
      })),
    );
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSpaces();
  }, [fetchSpaces]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(space: Space) {
    setEditing(space);
    setFormOpen(true);
  }

  function confirmDelete(space: Space) {
    setDeleteTarget(space);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('spaces').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) {
      toast.error('Error al eliminar el espacio');
      return;
    }
    toast.success('Espacio eliminado');
    setDeleteOpen(false);
    setDeleteTarget(null);
    fetchSpaces();
  }

  const term = search.trim().toLowerCase();
  const filtered = term
    ? spaces.filter(
        (s) =>
          s.name.toLowerCase().includes(term) ||
          (s.description ?? '').toLowerCase().includes(term),
      )
    : spaces;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Espacios de trabajo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Agrupa a tu equipo y sus registros por área o proyecto.
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="create spaces"
          onClick={openCreate}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="size-4" />
          Nuevo espacio
        </GatedButton>
      </div>

      {/* Search */}
      {spaces.length > 0 && (
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar espacios..."
            className="bg-card border-border pl-8 text-foreground placeholder:text-muted-foreground"
          />
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex flex-col items-center gap-2 py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Cargando espacios...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16">
          <FolderKanban className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {term ? 'No hay espacios que coincidan.' : 'Aún no hay espacios de trabajo.'}
          </p>
          {!term && (
            <GatedButton
              canAct={canEdit}
              gateReason="create spaces"
              variant="outline"
              size="sm"
              onClick={openCreate}
              className="mt-2 border-border text-muted-foreground hover:bg-muted"
            >
              <Plus className="size-3.5" />
              Crear el primero
            </GatedButton>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const c = spaceColor(s.color);
            return (
              <div
                key={s.id}
                className="group flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="mb-3 flex items-start justify-between">
                  <span className={`mt-1 size-3 shrink-0 rounded-full ${c.dot}`} />
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-popover border-border">
                        <DropdownMenuItem
                          onClick={() => openEdit(s)}
                          className="text-popover-foreground focus:bg-muted focus:text-foreground"
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem variant="destructive" onClick={() => confirmDelete(s)}>
                          <Trash2 className="size-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                <Link
                  href={`/spaces/${s.id}`}
                  className="text-base font-semibold text-foreground hover:text-primary"
                >
                  {s.name}
                </Link>
                <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
                  {s.description || 'Sin descripción'}
                </p>

                <div className="mt-4 flex items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5" />
                    {s.member_count} {s.member_count === 1 ? 'miembro' : 'miembros'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Link2 className="size-3.5" />
                    {s.record_count} {s.record_count === 1 ? 'registro' : 'registros'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form */}
      <SpaceForm
        open={formOpen}
        onOpenChange={setFormOpen}
        space={editing}
        onSaved={fetchSpaces}
      />

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Eliminar espacio</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Eliminar{' '}
              <span className="font-medium text-popover-foreground">{deleteTarget?.name}</span>? Se
              quitarán sus miembros y vínculos (los registros en sí no se borran).
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
