'use client';

// ============================================================
// LeadConvertDialog — convierte un Lead en Contacto y,
// opcionalmente, en una Oferta (deal) del pipeline (migration 032).
//
//  1. Resuelve / crea la empresa del lead.
//  2. Crea o reutiliza el Contacto (por teléfono).
//  3. Opcionalmente crea la Oferta en la etapa elegida.
//  4. Marca el lead como "converted" y guarda los vínculos.
// ============================================================

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Lead, Pipeline, PipelineStage, Profile } from '@/types';
import { CURRENCIES, DEFAULT_CURRENCY, formatCurrency } from '@/lib/currency';
import {
  findExistingContact,
  isUniqueViolation,
} from '@/lib/contacts/dedupe';
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
import { Loader2, UserPlus, GitBranch, ArrowRight } from 'lucide-react';

interface LeadConvertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onConverted: () => void;
}

const selectClass =
  'h-8 w-full min-w-0 rounded-lg border border-border bg-muted px-2.5 py-1 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm';

export function LeadConvertDialog({
  open,
  onOpenChange,
  lead,
  onConverted,
}: LeadConvertDialogProps) {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [createDeal, setCreateDeal] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [stageId, setStageId] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [assignedTo, setAssignedTo] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && lead) {
      setCreateDeal(false);
      setValue(lead.value != null && lead.value !== 0 ? String(lead.value) : '');
      setCurrency(lead.currency ?? DEFAULT_CURRENCY);
      setAssignedTo(lead.assigned_to ?? '');
      fetchPipelines(lead.assigned_to ?? '');
      fetchProfiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead]);

  useEffect(() => {
    if (!pipelineId) {
      setStages([]);
      setStageId('');
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('position');
      if (cancelled) return;
      const list = (data ?? []) as PipelineStage[];
      setStages(list);
      setStageId(list[0]?.id ?? '');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId]);

  async function fetchPipelines(preselectAssignee: string) {
    const { data } = await supabase
      .from('pipelines')
      .select('*')
      .order('created_at');
    const list = (data ?? []) as Pipeline[];
    setPipelines(list);
    setPipelineId(list[0]?.id ?? '');
    if (preselectAssignee) setAssignedTo(preselectAssignee);
  }

  async function fetchProfiles() {
    const { data } = await supabase.from('profiles').select('*').order('full_name');
    if (data) setProfiles(data as Profile[]);
  }

  async function handleConvert() {
    if (!lead) return;
    if (!lead.phone || !lead.phone.trim()) {
      toast.error('Añade un teléfono al lead antes de convertirlo en contacto.');
      return;
    }
    if (!accountId) {
      toast.error('Tu perfil no está vinculado a una cuenta.');
      return;
    }
    if (createDeal && (!pipelineId || !stageId)) {
      toast.error('Elige un pipeline y una etapa para la oferta.');
      return;
    }

    setSaving(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('No autenticado');

      const phone = lead.phone.trim();
      const organizationId = await resolveOrganizationId(
        supabase,
        accountId,
        user.id,
        lead.company,
      );

      // 1. Contacto: reutiliza si el teléfono ya existe.
      let contactId: string;
      const existing = await findExistingContact(supabase, accountId, phone);
      if (existing) {
        contactId = existing.id;
        // Completa campos vacíos sin sobrescribir lo que ya haya.
        const patch: Record<string, string | null> = {};
        if (!existing.name && lead.name) patch.name = lead.name;
        if (!existing.email && lead.email) patch.email = lead.email;
        if (!existing.company && lead.company) patch.company = lead.company;
        if (!(existing as { organization_id?: string | null }).organization_id && organizationId)
          patch.organization_id = organizationId;
        if (Object.keys(patch).length > 0) {
          await supabase.from('contacts').update(patch).eq('id', contactId);
        }
      } else {
        const { data, error } = await supabase
          .from('contacts')
          .insert({
            user_id: user.id,
            account_id: accountId,
            name: lead.name,
            phone,
            email: lead.email || null,
            company: lead.company || null,
            organization_id: organizationId,
            source: lead.source || 'other',
          })
          .select('id')
          .single();
        if (error) {
          if (isUniqueViolation(error)) {
            const again = await findExistingContact(supabase, accountId, phone);
            if (!again) throw error;
            contactId = again.id;
          } else {
            throw error;
          }
        } else {
          contactId = data.id;
        }
      }

      // 2. Oferta opcional.
      let dealId: string | null = null;
      if (createDeal) {
        const parsed = Number.parseFloat(value);
        const { data, error } = await supabase
          .from('deals')
          .insert({
            user_id: user.id,
            account_id: accountId,
            pipeline_id: pipelineId,
            stage_id: stageId,
            contact_id: contactId,
            title: lead.interest ? `${lead.name} — ${lead.interest}` : lead.name,
            value: Number.isFinite(parsed) ? parsed : 0,
            currency: currency || DEFAULT_CURRENCY,
            assigned_to: assignedTo || null,
            notes: lead.notes || null,
            status: 'open',
          })
          .select('id')
          .single();
        if (error) throw error;
        dealId = data.id;
      }

      // 3. Marca el lead como convertido.
      const { error: leadError } = await supabase
        .from('leads')
        .update({
          status: 'converted',
          converted_contact_id: contactId,
          converted_deal_id: dealId,
          converted_at: new Date().toISOString(),
        })
        .eq('id', lead.id);
      if (leadError) throw leadError;

      toast.success(
        dealId
          ? 'Lead convertido en contacto y oferta'
          : 'Lead convertido en contacto',
      );
      onOpenChange(false);
      onConverted();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al convertir el lead';
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
            Convertir lead
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Se creará un contacto a partir de{' '}
            <span className="font-medium text-popover-foreground">
              {lead?.name}
            </span>
            . Opcionalmente, también una oferta en el pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Paso 1 — contacto */}
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <UserPlus className="mt-0.5 size-4 text-primary" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Contacto</p>
              <p className="text-xs text-muted-foreground">
                {lead?.phone || '(sin teléfono)'}
                {lead?.email ? ` · ${lead.email}` : ''}
                {lead?.company ? ` · ${lead.company}` : ''}
              </p>
            </div>
          </div>

          {/* Paso 2 — oferta opcional */}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={createDeal}
              onChange={(e) => setCreateDeal(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            <GitBranch className="size-4 text-muted-foreground" />
            Crear también una oferta en el pipeline
          </label>

          {createDeal && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              {pipelines.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No hay pipelines todavía. Crea uno en «Pipeline de ventas»
                  para poder convertir a oferta.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="convert-pipeline" className="text-muted-foreground">
                        Pipeline
                      </Label>
                      <select
                        id="convert-pipeline"
                        value={pipelineId}
                        onChange={(e) => setPipelineId(e.target.value)}
                        className={selectClass}
                      >
                        {pipelines.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="convert-stage" className="text-muted-foreground">
                        Etapa
                      </Label>
                      <select
                        id="convert-stage"
                        value={stageId}
                        onChange={(e) => setStageId(e.target.value)}
                        className={selectClass}
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="convert-value" className="text-muted-foreground">
                        Valor
                      </Label>
                      <Input
                        id="convert-value"
                        type="number"
                        min="0"
                        step="0.01"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="0"
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="convert-currency" className="text-muted-foreground">
                        Moneda
                      </Label>
                      <select
                        id="convert-currency"
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

                  <div className="space-y-1.5">
                    <Label htmlFor="convert-assignee" className="text-muted-foreground">
                      Asignar a
                    </Label>
                    <select
                      id="convert-assignee"
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

                  {lead && Number(lead.value) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Valor estimado del lead:{' '}
                      {formatCurrency(Number(lead.value), lead.currency ?? DEFAULT_CURRENCY)}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
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
            onClick={handleConvert}
            disabled={saving || !lead?.phone}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            Convertir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
