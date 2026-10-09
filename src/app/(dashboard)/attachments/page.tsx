'use client';

// ============================================================
// Adjuntos (Attachments) — Core CRM, migration 035.
// Lista + filtros + subida + descarga firmada + borrado, RLS por cuenta.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  NOTE_ENTITY_TYPES,
  type Attachment,
  type Profile,
} from '@/types';
import { attachmentKind, formatFileSize } from '@/lib/attachments/file-utils';
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
  Trash2,
  Loader2,
  Paperclip,
  ChevronLeft,
  ChevronRight,
  Download,
  FileImage,
  FileText,
  FileSpreadsheet,
  FileArchive,
  Presentation,
  File,
  User,
  Target,
  Building2,
  Briefcase,
  CalendarCheck,
} from 'lucide-react';
import { AttachmentUploadDialog } from '@/components/attachments/attachment-upload-dialog';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';

const PAGE_SIZE = 25;

type TypeFilter = 'all' | 'none' | 'contact' | 'lead' | 'organization' | 'deal' | 'activity';

const KIND_ICON = {
  image: FileImage,
  pdf: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  archive: FileArchive,
  other: File,
} as const;

export default function AttachmentsPage() {
  const supabase = createClient();
  const canEdit = useCan('send-messages');

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Attachment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});
  const fetchSeq = useRef(0);

  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*');
    if (data) {
      const map: Record<string, Profile> = {};
      data.forEach((p) => (map[p.user_id] = p as Profile));
      setProfilesMap(map);
    }
  }, [supabase]);

  const fetchAttachments = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();

    let query = supabase
      .from('attachments')
      .select(
        '*, contact:contacts!attachments_contact_id_fkey(id,name,phone), lead:leads!attachments_lead_id_fkey(id,name), organization:organizations!attachments_organization_id_fkey(id,name), deal:deals!attachments_deal_id_fkey(id,title), activity:activities!attachments_activity_id_fkey(id,subject)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (typeFilter === 'none') {
      query = query
        .is('contact_id', null)
        .is('lead_id', null)
        .is('organization_id', null)
        .is('deal_id', null)
        .is('activity_id', null);
    } else if (typeFilter !== 'all') {
      query = query.not(`${typeFilter}_id`, 'is', null);
    }
    if (term) {
      query = query.ilike('file_name', `%${term}%`);
    }

    const { data, count, error } = await query;
    if (seq !== fetchSeq.current) return;
    if (error) {
      console.error('[attachments] fetch error:', error);
      toast.error('Error al cargar los adjuntos');
      setLoading(false);
      return;
    }

    setAttachments((data ?? []) as unknown as Attachment[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [supabase, page, search, typeFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProfiles();
  }, [fetchProfiles]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAttachments();
  }, [fetchAttachments]);

  async function handleDownload(att: Attachment) {
    setBusyId(att.id);
    const { data, error } = await supabase.storage
      .from('attachments')
      .createSignedUrl(att.file_path, 60);
    setBusyId(null);
    if (error || !data?.signedUrl) {
      toast.error('No se pudo generar el enlace de descarga');
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  function confirmDelete(att: Attachment) {
    setDeleteTarget(att);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    // 1) Borra la metadata (RLS) …
    const { error } = await supabase.from('attachments').delete().eq('id', deleteTarget.id);
    if (error) {
      toast.error('Error al eliminar el adjunto');
      setDeleting(false);
      return;
    }
    // 2) … y el binario (best-effort; un fallo deja un huérfano, no bloquea).
    await supabase.storage.from('attachments').remove([deleteTarget.file_path]);

    toast.success('Adjunto eliminado');
    setDeleting(false);
    setDeleteOpen(false);
    setDeleteTarget(null);
    fetchAttachments();
  }

  function linkInfo(att: Attachment): { label: string; icon: typeof User } | null {
    if (att.contact) return { label: `Contacto · ${att.contact.name || att.contact.phone}`, icon: User };
    if (att.lead) return { label: `Lead · ${att.lead.name}`, icon: Target };
    if (att.organization) return { label: `Empresa · ${att.organization.name}`, icon: Building2 };
    if (att.deal) return { label: `Oferta · ${att.deal.title}`, icon: Briefcase };
    if (att.activity) return { label: `Actividad · ${att.activity.subject}`, icon: CalendarCheck };
    return null;
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Adjuntos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Archivos ligados a tus registros del CRM.
            {totalCount > 0 && ` ${totalCount} archivo${totalCount === 1 ? '' : 's'} en total.`}
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="upload attachments"
          onClick={() => setUploadOpen(true)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="size-4" />
          Subir adjunto
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
            placeholder="Buscar por nombre de archivo..."
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
          <option value="activity">Actividad</option>
          <option value="none">Sin vincular</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Archivo</TableHead>
              <TableHead className="hidden text-muted-foreground md:table-cell">
                Vínculo
              </TableHead>
              <TableHead className="hidden text-muted-foreground lg:table-cell">
                Subido por
              </TableHead>
              <TableHead className="text-muted-foreground">Fecha</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={5} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Cargando adjuntos...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : attachments.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={5} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Paperclip className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {search.trim() || typeFilter !== 'all'
                        ? 'No hay adjuntos que coincidan con el filtro.'
                        : 'Aún no hay adjuntos.'}
                    </p>
                    {!search.trim() && typeFilter === 'all' && (
                      <GatedButton
                        canAct={canEdit}
                        gateReason="upload attachments"
                        variant="outline"
                        size="sm"
                        onClick={() => setUploadOpen(true)}
                        className="mt-2 border-border text-muted-foreground hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                        Subir tu primer archivo
                      </GatedButton>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              attachments.map((att) => {
                const Icon = KIND_ICON[attachmentKind(att.mime_type, att.file_name)];
                const link = linkInfo(att);
                const LinkIcon = link?.icon;
                return (
                  <TableRow key={att.id} className="border-border hover:bg-muted/50">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Icon className="size-4 text-muted-foreground" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {att.file_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(att.file_size)}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {link && LinkIcon ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          <LinkIcon className="size-3" />
                          {link.label}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {profilesMap[att.user_id]?.full_name ?? 'Usuario'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(att.created_at), 'd MMM yyyy', { locale: es })}
                    </TableCell>
                    <TableCell>
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
                            onClick={() => handleDownload(att)}
                            disabled={busyId === att.id}
                            className="text-popover-foreground focus:bg-muted focus:text-foreground"
                          >
                            {busyId === att.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Download className="size-4" />
                            )}
                            Descargar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-border" />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => confirmDelete(att)}
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

      {/* Upload */}
      <AttachmentUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={fetchAttachments}
      />

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Eliminar adjunto</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Estás seguro de que quieres eliminar{' '}
              <span className="font-medium text-popover-foreground">
                {deleteTarget?.file_name}
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
