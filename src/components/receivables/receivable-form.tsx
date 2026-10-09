'use client';

// ============================================================
// ReceivableForm — alta/edición de una cuenta por cobrar
// (Cobranza, migration 037). Dialog + Supabase cliente + RLS.
// Vínculos opcionales a contacto / empresa / oferta. Al elegir una
// oferta se autocompletan monto, moneda y contacto.
// ============================================================

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { type Receivable } from '@/types';
import { CURRENCIES, DEFAULT_CURRENCY, formatCurrency } from '@/lib/currency';
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

interface ReceivableFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receivable?: Receivable | null;
  onSaved: () => void;
}

interface Option {
  id: string;
  label: string;
}

interface DealOption extends Option {
  value: number;
  currency?: string | null;
  contact_id?: string | null;
}

const selectClass =
  'h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export function ReceivableForm({ open, onOpenChange, receivable, onSaved }: ReceivableFormProps) {
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();
  const isEdit = !!receivable;

  const [concept, setConcept] = useState('');
  const [contactId, setContactId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [dealId, setDealId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [contacts, setContacts] = useState<Option[]>([]);
  const [organizations, setOrganizations] = useState<Option[]>([]);
  const [deals, setDeals] = useState<DealOption[]>([]);

  useEffect(() => {
    if (!open) return;
    setConcept(receivable?.concept ?? '');
    setContactId(receivable?.contact_id ?? '');
    setOrganizationId(receivable?.organization_id ?? '');
    setDealId(receivable?.deal_id ?? '');
    setAmount(receivable?.amount != null ? String(receivable.amount) : '');
    setCurrency(receivable?.currency ?? defaultCurrency ?? DEFAULT_CURRENCY);
    setDueDate(receivable?.due_date ?? '');
    setNotes(receivable?.notes ?? '');

    (async () => {
      const [c, o, d] = await Promise.all([
        supabase.from('contacts').select('id, name, phone').order('name').limit(500),
        supabase.from('organizations').select('id, name').order('name').limit(500),
        supabase
          .from('deals')
          .select('id, title, value, currency, contact_id')
          .order('created_at', { ascending: false })
          .limit(500),
      ]);
      setContacts(
        ((c.data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          label: (r.name as string) || (r.phone as string) || (r.id as string),
        })),
      );
      setOrganizations(
        ((o.data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          label: (r.name as string) || (r.id as string),
        })),
      );
      setDeals(
        ((d.data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          label: (r.title as string) || (r.id as string),
          value: Number(r.value) || 0,
          currency: (r.currency as string) ?? null,
          contact_id: (r.contact_id as string) ?? null,
        })),
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, receivable, defaultCurrency]);

  function handleDealChange(id: string) {
    setDealId(id);
    const deal = deals.find((d) => d.id === id);
    if (deal) {
      setAmount(String(deal.value));
      if (deal.currency) setCurrency(deal.currency);
      if (deal.contact_id) setContactId(deal.contact_id);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!concept.trim()) {
      toast.error('El concepto es obligatorio');
      return;
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      toast.error('El monto debe ser un número mayor o igual a 0');
      return;
    }
    if (!accountId) {
      toast.error('Tu perfil no está vinculado a una cuenta.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        concept: concept.trim(),
        contact_id: contactId || null,
        organization_id: organizationId || null,
        deal_id: dealId || null,
        amount: amountNum,
        currency,
        due_date: dueDate || null,
        notes: notes.trim() || null,
      };

      if (isEdit && receivable) {
        const { error } = await supabase.from('receivables').update(payload).eq('id', receivable.id);
        if (error) throw error;
      } else {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error('No autenticado');
        const { error } = await supabase
          .from('receivables')
          .insert({ ...payload, account_id: accountId, created_by: user.id });
        if (error) throw error;
      }

      toast.success(isEdit ? 'Cuenta actualizada' : 'Cuenta por cobrar creada');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar la cuenta';
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
            {isEdit ? 'Editar cuenta por cobrar' : 'Nueva cuenta por cobrar'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Registra un importe a cobrar y su vencimiento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rcv-concept" className="text-muted-foreground">
              Concepto <span className="text-red-400">*</span>
            </Label>
            <Input
              id="rcv-concept"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="Ej. Suscripción anual — Empresa X"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rcv-contact" className="text-muted-foreground">
                Contacto
              </Label>
              <select
                id="rcv-contact"
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className={selectClass}
              >
                <option value="">Sin contacto</option>
                {contacts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rcv-org" className="text-muted-foreground">
                Empresa
              </Label>
              <select
                id="rcv-org"
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="rcv-deal" className="text-muted-foreground">
              Oferta vinculada
            </Label>
            <select
              id="rcv-deal"
              value={dealId}
              onChange={(e) => handleDealChange(e.target.value)}
              className={selectClass}
            >
              <option value="">Sin oferta</option>
              {deals.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} — {formatCurrency(o.value, o.currency ?? currency)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rcv-amount" className="text-muted-foreground">
                Monto <span className="text-red-400">*</span>
              </Label>
              <Input
                id="rcv-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rcv-currency" className="text-muted-foreground">
                Moneda
              </Label>
              <select
                id="rcv-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={selectClass}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rcv-due" className="text-muted-foreground">
              Vence el
            </Label>
            <Input
              id="rcv-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="bg-muted border-border text-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rcv-notes" className="text-muted-foreground">
              Notas
            </Label>
            <Textarea
              id="rcv-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalles del cobro, condiciones, etc."
              rows={2}
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
