'use client';

// ============================================================
// Notas internas (Notes) — Core CRM, migration 034.
// Lista + filtros + CRUD + fijar, con RLS por cuenta.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  NOTE_ENTITY_TYPES,
  type Note,
  type Profile,
} from '@/types';
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
  StickyNote,
  ChevronLeft,
  ChevronRight,
  Pin,
  PinOff,
  User,
  Building2,
  Target,
  Briefcase,
} from 'lucide-react';
import { NoteForm } from '@/components/notes/note-form';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';

const PAGE_SIZE = 20;

type TypeFilter = 'all' | 'none' | 'contact' | 'lead' | 'organization' | 'deal';

export default function NotesPage() {
  const supabase = createClient();
  const canEdit = useCan('send-messages');

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});
  const fetchSeq = useRef(0);

  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*');
    if (data) {
      const map: Record<string, Profile> = {};
      data.forEach((p) => (map[p.id] = p as Profile));
      setProfilesMap(map);
    }
  }, [supabase]);

  const fetchNotes = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();

    let query = supabase
      .from('notes')
      .select(
        '*, contact:contacts!notes_contact_id_fkey(id,name,phone), lead:leads!notes_lead_id_fkey(id,name), organization:organizations!notes_organization_id_fkey(id,name), deal:deals!notes_deal_id_fkey(id,title)',
        { count: 'exact' },
      )
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (typeFilter === 'none') {
      query = query
        .is('contact_id', null)
        .is('lead_id', null)
        .is('organization_id', null)
        .is('deal_id', null);
    } else if (typeFilter !== 'all') {
      query = query.not(`${typeFilter}_id`, 'is', null);
    }
    if (term) {
      query = query.ilike('body', `%${term}%`);
    }

    const { data, count, error } = await query;
    if (seq !== fetchSeq.current) return;
    if (error) {
      console.error('[notes] fetch error:', error);
      toast.error('Error al cargar las notas');
      setLoading(false);
      return;
    }

    setNotes((data ?? []) as unknown as Note[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [supabase, page, search, typeFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProfiles();
  }, [fetchProfiles]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotes();
  }, [fetchNotes]);

  function openAddForm() {
    setEditNote(null);
    setFormOpen(true);
  }

  function openEditForm(note: Note) {
    setEditNote(note);
    setFormOpen(true);
  }

  function confirmDelete(note: Note) {
    setDeleteTarget(note);
    setDeleteOpen(true);
  }

  async function togglePin(note: Note) {
    setBusyId(note.id);
    const { error } = await supabase
      .from('notes')
      .update({ pinned: !note.pinned })
      .eq('id', note.id);
    setBusyId(null);
    if (error) {
      toast.error('Error al actualizar la nota');
    } else {
      toast.success(note.pinned ? 'Nota desfijada' : 'Nota fijada');
      fetchNotes();
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('notes').delete().eq('id', deleteTarget.id);
    if (error) {
      toast.error('Error al eliminar la nota');
    } else {
      toast.success('Nota eliminada');
      fetchNotes();
    }
    setDeleting(false);
    setDeleteOpen(false);
    setDeleteTarget(null);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  function linkInfo(note: Note): { label: string; icon: typeof User } | null {
    if (note.contact) return { label: `Contacto · ${note.contact.name || note.contact.phone}`, icon: User };
    if (note.lead) return { label: `Lead · ${note.lead.name}`, icon: Target };
    if (note.organization) return { label: `Empresa · ${note.organization.name}`, icon: Building2 };
    if (note.deal) return { label: `Oferta · ${note.deal.title}`, icon: Briefcase };
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notas internas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Anotaciones del equipo ligadas a tus registros del CRM.
            {totalCount > 0 && ` ${totalCount} nota${totalCount === 1 ? '' : 's'} en total.`}
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="create notes"
          onClick={openAddForm}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="size-4" />
          Nueva nota
        </GatedButton>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Buscar en las notas..."
            className="bg-card border-border pl-8 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as TypeFilter);
            setPage(0);
          }}
          className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="all">Todas</option>
          {NOTE_ENTITY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
          <option value="none">Sin vincular</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col items-center gap-2 py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Cargando notas...</p>
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border py-16">
          <StickyNote className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {search.trim() || typeFilter !== 'all'
              ? 'No hay notas que coincidan con el filtro.'
              : 'Aún no hay notas internas.'}
          </p>
          {!search.trim() && typeFilter === 'all' && (
            <GatedButton
              canAct={canEdit}
              gateReason="create notes"
              variant="outline"
              size="sm"
              onClick={openAddForm}
              className="mt-2 border-border text-muted-foreground hover:bg-muted"
            >
              <Plus className="size-3.5" />
              Crear tu primera nota
            </GatedButton>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {notes.map((note) => {
            const link = linkInfo(note);
            const LinkIcon = link?.icon;
            const author = profilesMap[note.user_id];
            return (
              <div
                key={note.id}
                className={`group relative rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 ${
                  note.pinned ? 'border-amber-500/40' : 'border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {note.pinned && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                        <Pin className="size-3" />
                        Fijada
                      </span>
                    )}
                    {link && LinkIcon && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <LinkIcon className="size-3" />
                        {link.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!canEdit || busyId === note.id}
                      onClick={() => togglePin(note)}
                      title={note.pinned ? 'Desfijar' : 'Fijar'}
                      className="text-muted-foreground transition-colors hover:text-amber-300 disabled:opacity-40"
                    >
                      {busyId === note.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : note.pinned ? (
                        <PinOff className="size-4" />
                      ) : (
                        <Pin className="size-4" />
                      )}
                    </button>
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
                          onClick={() => openEditForm(note)}
                          className="text-popover-foreground focus:bg-muted focus:text-foreground"
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => confirmDelete(note)}
                        >
                          <Trash2 className="size-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                  {note.body}
                </p>

                <p className="mt-3 text-xs text-muted-foreground">
                  {author?.full_name ?? 'Usuario'} ·{' '}
                  {format(new Date(note.created_at), "d MMM yyyy, HH:mm", { locale: es })}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Mostrando {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} de{' '}
            {totalCount}
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
      <NoteForm
        open={formOpen}
        onOpenChange={setFormOpen}
        note={editNote}
        onSaved={fetchNotes}
      />

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Eliminar nota</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Estás seguro de que quieres eliminar esta nota? Esta acción no se puede deshacer.
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
