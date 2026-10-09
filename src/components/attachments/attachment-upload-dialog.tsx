'use client';

// ============================================================
// AttachmentUploadDialog — subir un Adjunto (migration 035).
// Sube el binario al bucket privado `attachments` (path
// account-scoped) y registra la metadata + vínculos en `attachments`.
// ============================================================

import { useRef, useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { uploadAccountMedia } from '@/lib/storage/upload-media';
import { ATTACHMENT_MAX_BYTES, formatFileSize } from '@/lib/attachments/file-utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, Paperclip } from 'lucide-react';

interface AttachmentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}

const selectClass =
  'h-8 w-full min-w-0 rounded-lg border border-border bg-muted px-2.5 py-1 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm';

interface Option {
  id: string;
  label: string;
}

export function AttachmentUploadDialog({
  open,
  onOpenChange,
  onUploaded,
}: AttachmentUploadDialogProps) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [contactId, setContactId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [dealId, setDealId] = useState('');
  const [activityId, setActivityId] = useState('');
  const [uploading, setUploading] = useState(false);

  const [contacts, setContacts] = useState<Option[]>([]);
  const [leads, setLeads] = useState<Option[]>([]);
  const [organizations, setOrganizations] = useState<Option[]>([]);
  const [deals, setDeals] = useState<Option[]>([]);
  const [activities, setActivities] = useState<Option[]>([]);

  useEffect(() => {
    if (open) {
      setFile(null);
      setContactId('');
      setLeadId('');
      setOrganizationId('');
      setDealId('');
      setActivityId('');
      if (inputRef.current) inputRef.current.value = '';
      fetchOptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function fetchOptions() {
    const [c, l, o, d, a] = await Promise.all([
      supabase.from('contacts').select('id, name, phone').order('name').limit(500),
      supabase.from('leads').select('id, name').order('name').limit(500),
      supabase.from('organizations').select('id, name').order('name').limit(500),
      supabase.from('deals').select('id, title').order('created_at', { ascending: false }).limit(500),
      supabase.from('activities').select('id, subject').order('created_at', { ascending: false }).limit(500),
    ]);
    if (c.data)
      setContacts(
        c.data.map((r: { id: string; name?: string | null; phone?: string | null }) => ({
          id: r.id,
          label: r.name ? `${r.name}${r.phone ? ` · ${r.phone}` : ''}` : r.phone || r.id,
        })),
      );
    if (l.data)
      setLeads(l.data.map((r: { id: string; name: string }) => ({ id: r.id, label: r.name })));
    if (o.data)
      setOrganizations(o.data.map((r: { id: string; name: string }) => ({ id: r.id, label: r.name })));
    if (d.data)
      setDeals(d.data.map((r: { id: string; title: string }) => ({ id: r.id, label: r.title })));
    if (a.data)
      setActivities(a.data.map((r: { id: string; subject: string }) => ({ id: r.id, label: r.subject })));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    if (selected && selected.size > ATTACHMENT_MAX_BYTES) {
      toast.error(`El archivo supera el máximo de ${formatFileSize(ATTACHMENT_MAX_BYTES)}`);
      if (inputRef.current) inputRef.current.value = '';
      setFile(null);
      return;
    }
    setFile(selected);
  }

  async function handleUpload() {
    if (!file) {
      toast.error('Selecciona un archivo');
      return;
    }
    if (!accountId) {
      toast.error('Tu perfil no está vinculado a una cuenta.');
      return;
    }

    setUploading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('No autenticado');

      // 1) Sube el binario al bucket privado (path account-scoped).
      const { path } = await uploadAccountMedia('attachments', file);

      // 2) Registra la metadata + vínculos.
      const { error } = await supabase.from('attachments').insert({
        user_id: user.id,
        account_id: accountId,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type || null,
        contact_id: contactId || null,
        lead_id: leadId || null,
        organization_id: organizationId || null,
        deal_id: dealId || null,
        activity_id: activityId || null,
      });
      if (error) throw error;

      toast.success('Archivo adjuntado');
      onOpenChange(false);
      onUploaded();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al subir el archivo';
      toast.error(message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Subir adjunto</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Sube un archivo (máx. {formatFileSize(ATTACHMENT_MAX_BYTES)}) y vincúlalo a un registro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Selector de archivo */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Archivo</Label>
            <input
              ref={inputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
              id="attachment-file-input"
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-left transition-colors hover:border-primary/40"
            >
              <Paperclip className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                {file ? (
                  <>
                    <p className="truncate text-sm text-foreground">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Haz clic para elegir un archivo
                  </p>
                )}
              </div>
            </button>
          </div>

          {/* Vínculos */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Vincular a
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="att-contact" className="text-muted-foreground">
                  Contacto
                </Label>
                <select
                  id="att-contact"
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Sin contacto</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="att-lead" className="text-muted-foreground">
                  Lead
                </Label>
                <select
                  id="att-lead"
                  value={leadId}
                  onChange={(e) => setLeadId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Sin lead</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="att-org" className="text-muted-foreground">
                  Empresa
                </Label>
                <select
                  id="att-org"
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Sin empresa</option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="att-deal" className="text-muted-foreground">
                  Oferta
                </Label>
                <select
                  id="att-deal"
                  value={dealId}
                  onChange={(e) => setDealId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Sin oferta</option>
                  {deals.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="att-activity" className="text-muted-foreground">
                  Actividad
                </Label>
                <select
                  id="att-activity"
                  value={activityId}
                  onChange={(e) => setActivityId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Sin actividad</option>
                  {activities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleUpload}
            disabled={!file || uploading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Subir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
