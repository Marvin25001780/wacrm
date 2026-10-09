'use client';

// ============================================================
// LeadForm — alta/edición de Leads (migration 032).
// Mismo patrón que ContactForm/OrganizationForm: dialog + Supabase
// cliente + RLS. La empresa escrita se resuelve/crea automáticamente.
// ============================================================

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import {
  CONTACT_SOURCES,
  LEAD_STATUSES,
  type Lead,
  type LeadStatus,
  type Profile,
} from '@/types';
import { CURRENCIES, DEFAULT_CURRENCY } from '@/lib/currency';
import { resolveOrganizationId } from '@/lib/organizations/resolve';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

interface LeadFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: Lead | null;
  onSaved: () => void;
}

const selectClass =
  'h-8 w-full min-w-0 rounded-lg border border-border bg-muted px-2.5 py-1 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm';

export function LeadForm({ open, onOpenChange, lead, onSaved }: LeadFormProps) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const isEdit = !!lead;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState<LeadStatus>('new');
  const [interest, setInterest] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [assignedTo, setAssignedTo] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    if (open) {
      setName(lead?.name ?? '');
      setPhone(lead?.phone ?? '');
      setEmail(lead?.email ?? '');
      setCompany(lead?.company ?? '');
      setJobTitle(lead?.job_title ?? '');
      setSource(lead?.source ?? '');
      setStatus((lead?.status as LeadStatus) ?? 'new');
      setInterest(lead?.interest ?? '');
      setValue(lead?.value != null ? String(lead.value) : '');
      setCurrency(lead?.currency ?? DEFAULT_CURRENCY);
      setAssignedTo(lead?.assigned_to ?? '');
      setNotes(lead?.notes ?? '');
      fetchOrganizations();
      fetchProfiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead]);

  async function fetchOrganizations() {
    const { data } = await supabase
      .from('organizations')
      .select('id, name')
      .order('name');
    if (data) setOrganizations(data);
  }

  async function fetchProfiles() {
    const { data } = await supabase.from('profiles').select('*').order('full_name');
    if (data) setProfiles(data as Profile[]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('El nombre del lead es obligatorio');
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

      const organizationId = await resolveOrganizationId(
        supabase,
        accountId,
        user.id,
        company,
      );

      const parsedValue = Number.parseFloat(value);
      const payload = {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        company: company.trim() || null,
        organization_id: organizationId,
        job_title: jobTitle.trim() || null,
        source: source || null,
        status,
        interest: interest.trim() || null,
        value: Number.isFinite(parsedValue) ? parsedValue : 0,
        currency: currency || DEFAULT_CURRENCY,
        assigned_to: assignedTo || null,
        notes: notes.trim() || null,
      };

      if (isEdit && lead) {
        const { error } = await supabase
          .from('leads')
          .update(payload)
          .eq('id', lead.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('leads').insert({
          ...payload,
          user_id: user.id,
          account_id: accountId,
        });
        if (error) throw error;
      }

      toast.success(isEdit ? 'Lead actualizado' : 'Lead creado');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al guardar el lead';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isEdit ? 'Editar lead' : 'Nuevo lead'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isEdit
              ? 'Actualiza los datos del prospecto.'
              : 'Registra un prospecto para darle seguimiento antes de convertirlo en contacto.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lead-name" className="text-muted-foreground">
                Nombre <span className="text-red-400">*</span>
              </Label>
              <Input
                id="lead-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Juan Pérez"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-phone" className="text-muted-foreground">
                Teléfono
              </Label>
              <Input
                id="lead-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+58 412 1234567"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lead-email" className="text-muted-foreground">
                Correo electrónico
              </Label>
              <Input
                id="lead-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prospecto@ejemplo.com"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-job" className="text-muted-foreground">
                Cargo
              </Label>
              <Input
                id="lead-job"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Gerente de compras"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lead-company" className="text-muted-foreground">
              Empresa
            </Label>
            <Input
              id="lead-company"
              list="lead-org-list"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme S.A."
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
            <datalist id="lead-org-list">
              {organizations.map((org) => (
                <option key={org.id} value={org.name} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lead-source" className="text-muted-foreground">
                Origen
              </Label>
              <select
                id="lead-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={selectClass}
              >
                <option value="">Sin especificar</option>
                {CONTACT_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-status" className="text-muted-foreground">
                Estado
              </Label>
              <select
                id="lead-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as LeadStatus)}
                className={selectClass}
              >
                {LEAD_STATUSES.filter((s) => s.value !== 'converted').map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="lead-value" className="text-muted-foreground">
                Valor estimado
              </Label>
              <Input
                id="lead-value"
                type="number"
                min="0"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-currency" className="text-muted-foreground">
                Moneda
              </Label>
              <select
                id="lead-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={selectClass}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lead-interest" className="text-muted-foreground">
                Interés
              </Label>
              <Input
                id="lead-interest"
                value={interest}
                onChange={(e) => setInterest(e.target.value)}
                placeholder="Producto / servicio de interés"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-assignee" className="text-muted-foreground">
                Asignado a
              </Label>
              <select
                id="lead-assignee"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className={selectClass}
              >
                <option value="">Sin asignar</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lead-notes" className="text-muted-foreground">
              Notas
            </Label>
            <Textarea
              id="lead-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Información adicional del prospecto..."
              rows={3}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
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
