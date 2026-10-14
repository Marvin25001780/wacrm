'use client';

// ============================================================
// ActivityForm — alta/edición de Actividades (migration 033).
// Dialog + Supabase cliente + RLS. Permite vincular la actividad
// a un Contacto, Lead, Empresa y/o Oferta.
// ============================================================

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import {
  ACTIVITY_PRIORITIES,
  ACTIVITY_STATUSES,
  ACTIVITY_TYPES,
  CALL_DIRECTIONS,
  CALL_RESULTS,
  type Activity,
  type ActivityPriority,
  type ActivityStatus,
  type ActivityType,
  type CallDirection,
  type CallResult,
  type Profile,
} from '@/types';
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

interface ActivityFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity?: Activity | null;
  /** Tipo preseleccionado al crear (p. ej. 'call' desde Métricas). */
  defaultType?: ActivityType;
  /** Prefills the "status" filter when creating from a filtered view. */
  onSaved: () => void;
}

const selectClass =
  'h-8 w-full min-w-0 rounded-lg border border-border bg-muted px-2.5 py-1 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm';

/** ISO timestamp → value para <input type="datetime-local"> (hora local). */
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

interface Option {
  id: string;
  label: string;
}

export function ActivityForm({
  open,
  onOpenChange,
  activity,
  defaultType,
  onSaved,
}: ActivityFormProps) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const isEdit = !!activity;

  const [subject, setSubject] = useState('');
  const [type, setType] = useState<ActivityType>('task');
  const [dueAt, setDueAt] = useState('');
  const [duration, setDuration] = useState('');
  const [priority, setPriority] = useState<ActivityPriority>('medium');
  const [status, setStatus] = useState<ActivityStatus>('pending');
  const [assignedTo, setAssignedTo] = useState('');
  const [contactId, setContactId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [dealId, setDealId] = useState('');
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState('');
  const [callDirection, setCallDirection] = useState<CallDirection | ''>('');
  const [callResult, setCallResult] = useState<CallResult | ''>('');
  const [saving, setSaving] = useState(false);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [contacts, setContacts] = useState<Option[]>([]);
  const [leads, setLeads] = useState<Option[]>([]);
  const [organizations, setOrganizations] = useState<Option[]>([]);
  const [deals, setDeals] = useState<Option[]>([]);

  useEffect(() => {
    if (open) {
      setSubject(activity?.subject ?? '');
      setType((activity?.type as ActivityType) ?? defaultType ?? 'task');
      setDueAt(toLocalInput(activity?.due_at));
      setDuration(activity?.duration_minutes != null ? String(activity.duration_minutes) : '');
      setPriority((activity?.priority as ActivityPriority) ?? 'medium');
      setStatus((activity?.status as ActivityStatus) ?? 'pending');
      setAssignedTo(activity?.assigned_to ?? '');
      setContactId(activity?.contact_id ?? '');
      setLeadId(activity?.lead_id ?? '');
      setOrganizationId(activity?.organization_id ?? '');
      setDealId(activity?.deal_id ?? '');
      setDescription(activity?.description ?? '');
      setOutcome(activity?.outcome ?? '');
      setCallDirection((activity?.call_direction as CallDirection) ?? null);
      setCallResult((activity?.call_result as CallResult) ?? null);
      fetchOptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activity]);

  async function fetchOptions() {
    const [p, c, l, o, d] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('contacts').select('id, name, phone').order('name').limit(500),
      supabase.from('leads').select('id, name').order('name').limit(500),
      supabase.from('organizations').select('id, name').order('name').limit(500),
      supabase.from('deals').select('id, title').order('created_at', { ascending: false }).limit(500),
    ]);
    if (p.data) setProfiles(p.data as Profile[]);
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

    if (!subject.trim()) {
      toast.error('El asunto de la actividad es obligatorio');
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

      const parsedDuration = Number.parseInt(duration, 10);
      const payload = {
        subject: subject.trim(),
        type,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        duration_minutes: Number.isFinite(parsedDuration) ? parsedDuration : null,
        priority,
        status,
        assigned_to: assignedTo || null,
        contact_id: contactId || null,
        lead_id: leadId || null,
        organization_id: organizationId || null,
        deal_id: dealId || null,
        description: description.trim() || null,
        outcome: outcome.trim() || null,
        call_direction: type === 'call' ? callDirection || null : null,
        call_result: type === 'call' ? callResult || null : null,
        completed_at: status === 'done' ? new Date().toISOString() : null,
      };

      if (isEdit && activity) {
        const { error } = await supabase
          .from('activities')
          .update(payload)
          .eq('id', activity.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('activities').insert({
          ...payload,
          user_id: user.id,
          account_id: accountId,
        });
        if (error) throw error;
      }

      toast.success(isEdit ? 'Actividad actualizada' : 'Actividad creada');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al guardar la actividad';
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
            {isEdit ? 'Editar actividad' : 'Nueva actividad'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isEdit
              ? 'Actualiza los datos de la actividad.'
              : 'Programa una llamada, reunión o tarea y vincúlala a tu CRM.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="act-subject" className="text-muted-foreground">
              Asunto <span className="text-red-400">*</span>
            </Label>
            <Input
              id="act-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Llamar para dar seguimiento"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="act-type" className="text-muted-foreground">
                Tipo
              </Label>
              <select
                id="act-type"
                value={type}
                onChange={(e) => setType(e.target.value as ActivityType)}
                className={selectClass}
              >
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="act-priority" className="text-muted-foreground">
                Prioridad
              </Label>
              <select
                id="act-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as ActivityPriority)}
                className={selectClass}
              >
                {ACTIVITY_PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="act-due" className="text-muted-foreground">
                Fecha y hora
              </Label>
              <Input
                id="act-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="act-duration" className="text-muted-foreground">
                Duración (min)
              </Label>
              <Input
                id="act-duration"
                type="number"
                min="0"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="30"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="act-status" className="text-muted-foreground">
                Estado
              </Label>
              <select
                id="act-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ActivityStatus)}
                className={selectClass}
              >
                {ACTIVITY_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="act-assignee" className="text-muted-foreground">
                Asignado a
              </Label>
              <select
                id="act-assignee"
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

          {type === 'call' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="act-direction" className="text-muted-foreground">
                  Dirección
                </Label>
                <select
                  id="act-direction"
                  value={callDirection}
                  onChange={(e) => setCallDirection(e.target.value as CallDirection | '')}
                  className={selectClass}
                >
                  <option value="">Sin especificar</option>
                  {CALL_DIRECTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="act-result" className="text-muted-foreground">
                  Resultado
                </Label>
                <select
                  id="act-result"
                  value={callResult}
                  onChange={(e) => setCallResult(e.target.value as CallResult | '')}
                  className={selectClass}
                >
                  <option value="">Sin especificar</option>
                  {CALL_RESULTS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Vínculos */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Vincular a
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="act-contact" className="text-muted-foreground">
                  Contacto
                </Label>
                <select
                  id="act-contact"
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
                <Label htmlFor="act-lead" className="text-muted-foreground">
                  Lead
                </Label>
                <select
                  id="act-lead"
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
                <Label htmlFor="act-org" className="text-muted-foreground">
                  Empresa
                </Label>
                <select
                  id="act-org"
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
                <Label htmlFor="act-deal" className="text-muted-foreground">
                  Oferta
                </Label>
                <select
                  id="act-deal"
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

          <div className="space-y-2">
            <Label htmlFor="act-description" className="text-muted-foreground">
              Descripción
            </Label>
            <Textarea
              id="act-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalles de la actividad..."
              rows={2}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {status === 'done' && (
            <div className="space-y-2">
              <Label htmlFor="act-outcome" className="text-muted-foreground">
                Resultado
              </Label>
              <Textarea
                id="act-outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                placeholder="¿Cómo terminó la actividad?"
                rows={2}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          )}

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
