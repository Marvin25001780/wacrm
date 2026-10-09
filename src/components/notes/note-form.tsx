'use client';

// ============================================================
// NoteForm — alta/edición de Notas internas (migration 034).
// Dialog + Supabase cliente + RLS. Permite vincular la nota a un
// Contacto, Lead, Empresa y/o Oferta (o dejarla suelta).
// ============================================================

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { type Note } from '@/types';
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
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';

interface NoteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note?: Note | null;
  onSaved: () => void;
}

const selectClass =
  'h-8 w-full min-w-0 rounded-lg border border-border bg-muted px-2.5 py-1 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm';

interface Option {
  id: string;
  label: string;
}

export function NoteForm({ open, onOpenChange, note, onSaved }: NoteFormProps) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const isEdit = !!note;

  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [contactId, setContactId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [dealId, setDealId] = useState('');
  const [saving, setSaving] = useState(false);

  const [contacts, setContacts] = useState<Option[]>([]);
  const [leads, setLeads] = useState<Option[]>([]);
  const [organizations, setOrganizations] = useState<Option[]>([]);
  const [deals, setDeals] = useState<Option[]>([]);

  useEffect(() => {
    if (open) {
      setBody(note?.body ?? '');
      setPinned(note?.pinned ?? false);
      setContactId(note?.contact_id ?? '');
      setLeadId(note?.lead_id ?? '');
      setOrganizationId(note?.organization_id ?? '');
      setDealId(note?.deal_id ?? '');
      fetchOptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, note]);

  async function fetchOptions() {
    const [c, l, o, d] = await Promise.all([
      supabase.from('contacts').select('id, name, phone').order('name').limit(500),
      supabase.from('leads').select('id, name').order('name').limit(500),
      supabase.from('organizations').select('id, name').order('name').limit(500),
      supabase.from('deals').select('id, title').order('created_at', { ascending: false }).limit(500),
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
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!body.trim()) {
      toast.error('La nota no puede estar vacía');
      return;
    }
    if (!accountId) {
      toast.error('Tu perfil no está vinculado a una cuenta.');
      return;
    }

    setSaving(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('No autenticado');

      const payload = {
        body: body.trim(),
        pinned,
        contact_id: contactId || null,
        lead_id: leadId || null,
        organization_id: organizationId || null,
        deal_id: dealId || null,
      };

      if (isEdit && note) {
        const { error } = await supabase.from('notes').update(payload).eq('id', note.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('notes').insert({
          ...payload,
          user_id: user.id,
          account_id: accountId,
        });
        if (error) throw error;
      }

      toast.success(isEdit ? 'Nota actualizada' : 'Nota creada');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar la nota';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isEdit ? 'Editar nota' : 'Nueva nota interna'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isEdit
              ? 'Actualiza el contenido de la nota.'
              : 'Anota información interna y vincúlala a un registro del CRM.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="note-body" className="text-muted-foreground">
              Nota <span className="text-red-400">*</span>
            </Label>
            <Textarea
              id="note-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Escribe la nota interna..."
              rows={4}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5">
            <Checkbox checked={pinned} onCheckedChange={(v) => setPinned(!!v)} />
            <span className="text-sm text-foreground">Fijar arriba</span>
          </label>

          {/* Vínculos */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Vincular a
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="note-contact" className="text-muted-foreground">
                  Contacto
                </Label>
                <select
                  id="note-contact"
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
                <Label htmlFor="note-lead" className="text-muted-foreground">
                  Lead
                </Label>
                <select
                  id="note-lead"
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
                <Label htmlFor="note-org" className="text-muted-foreground">
                  Empresa
                </Label>
                <select
                  id="note-org"
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
                <Label htmlFor="note-deal" className="text-muted-foreground">
                  Oferta
                </Label>
                <select
                  id="note-deal"
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
              type="submit"
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? 'Actualizar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
