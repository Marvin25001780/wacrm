'use client';

// ============================================================
// PaymentForm — registrar un abono contra una cuenta por cobrar
// (Cobranza, migration 037). El estado de la cuenta lo recalcula
// un trigger en la BD a partir de la suma de abonos.
// ============================================================

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { PAYMENT_METHODS, type Receivable, type PaymentMethod } from '@/types';
import { formatCurrency } from '@/lib/currency';
import { receivableBalance, todayIso } from '@/lib/receivables/utils';
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

interface PaymentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receivable: Receivable;
  onSaved: () => void;
}

const selectClass =
  'h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export function PaymentForm({ open, onOpenChange, receivable, onSaved }: PaymentFormProps) {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const balance = receivableBalance(receivable);

  useEffect(() => {
    if (!open) return;
    setAmount(balance > 0 ? String(balance) : '');
    setPaidAt(todayIso());
    setMethod('');
    setReference('');
    setNotes('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, receivable.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error('El abono debe ser mayor que 0');
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

      const { error } = await supabase.from('receivable_payments').insert({
        receivable_id: receivable.id,
        account_id: accountId,
        amount: amountNum,
        paid_at: paidAt,
        method: method || null,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        created_by: user.id,
      });
      if (error) throw error;

      toast.success('Abono registrado');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al registrar el abono';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Registrar abono</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {receivable.concept} — saldo {formatCurrency(balance, receivable.currency)}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="pay-amount" className="text-muted-foreground">
                Monto <span className="text-red-400">*</span>
              </Label>
              {balance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(String(balance))}
                  className="text-xs text-primary hover:underline"
                >
                  Pagar saldo total
                </button>
              )}
            </div>
            <Input
              id="pay-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pay-date" className="text-muted-foreground">
                Fecha
              </Label>
              <Input
                id="pay-date"
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-method" className="text-muted-foreground">
                Método
              </Label>
              <select
                id="pay-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod | '')}
                className={selectClass}
              >
                <option value="">Sin especificar</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pay-ref" className="text-muted-foreground">
              Referencia
            </Label>
            <Input
              id="pay-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Nº de transferencia, recibo..."
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pay-notes" className="text-muted-foreground">
              Notas
            </Label>
            <Textarea
              id="pay-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
