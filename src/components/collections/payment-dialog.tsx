"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  COLLECTION_PAYMENT_METHODS,
  type CollectionInstallment,
} from "@/types/collections";
import { formatUsd, installmentBalance, todayIso } from "@/lib/collections/format";

interface PaymentDialogProps {
  installment: CollectionInstallment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const selectClass =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function PaymentDialog({
  installment,
  open,
  onOpenChange,
  onSaved,
}: PaymentDialogProps) {
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayIso());
  const [method, setMethod] = useState("transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const balance = installment ? installmentBalance(installment) : 0;

  useEffect(() => {
    if (installment) {
      setAmount(balance.toFixed(2));
      setPaidAt(todayIso());
      setMethod("transfer");
      setReference("");
      setNotes("");
    }
  }, [installment, balance]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!installment) return;

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("El monto debe ser mayor que cero.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/cobranza/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payments: [
            {
              installment_id: installment.id,
              amount: value,
              paid_at: paidAt,
              method,
              reference: reference || undefined,
              notes: notes || undefined,
            },
          ],
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "No se pudo registrar el pago.");

      toast.success("Pago registrado");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el pago.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Registrar pago</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {installment
              ? `Cuota ${installment.number} · saldo ${formatUsd(balance)}`
              : "Selecciona una cuota."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pay-amount" className="text-muted-foreground">
                Monto (USD)
              </Label>
              <Input
                id="pay-amount"
                type="number"
                min="0.01"
                step="0.01"
                max={balance}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-date" className="text-muted-foreground">
                Fecha
              </Label>
              <Input
                id="pay-date"
                type="date"
                value={paidAt}
                onChange={(event) => setPaidAt(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pay-method" className="text-muted-foreground">
              Método
            </Label>
            <select
              id="pay-method"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              className={selectClass}
            >
              {COLLECTION_PAYMENT_METHODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pay-reference" className="text-muted-foreground">
              Referencia
            </Label>
            <Input
              id="pay-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Nro. de transferencia, recibo..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pay-notes" className="text-muted-foreground">
              Notas
            </Label>
            <Textarea
              id="pay-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter className="border-border bg-popover">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !installment}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Registrar pago
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
