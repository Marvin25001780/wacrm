'use client';

// ============================================================
// CloseConversationDialog
//
// Al cerrar una conversación desde la Bandeja solo se pide el motivo
// de cierre (catálogo + texto libre para "Otro"). El CSAT NO se pide
// aquí: lo debe responder el cliente, no el agente; una nota puesta
// por el agente mide su percepción, no la satisfacción del cliente.
//
// El diálogo solo recolecta la información; la persistencia la hace
// el padre (MessageThread) para no duplicar la lógica de Supabase.
// ============================================================

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { CLOSE_REASON_OTHER, CLOSE_REASONS } from '@/lib/inbox/close-reasons';

export interface CloseConversationPayload {
  /** Motivo de cierre (null si no se eligió ninguno). */
  reason: string | null;
}

export function CloseConversationDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: CloseConversationPayload) => Promise<void> | void;
}) {
  const [reasonChoice, setReasonChoice] = useState<string | null>(null);
  const [customReason, setCustomReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [reasonOptions, setReasonOptions] = useState<string[]>([
    ...CLOSE_REASONS,
  ]);

  const supabase = createClient();
  const { accountId } = useAuth();

  // Reinicia el formulario cada vez que se abre.
  useEffect(() => {
    if (!open) return;
    setReasonChoice(null);
    setCustomReason('');
    setSaving(false);
  }, [open]);

  // Catálogo gestionado en Configuración → Cierre de conversaciones.
  // Si la cuenta aún no tiene motivos, se conserva el catálogo estático.
  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('close_reasons')
        .select('label')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .order('position', { ascending: true });
      if (!cancelled && data && data.length > 0) {
        setReasonOptions((data as { label: string }[]).map((r) => r.label));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, supabase]);

  const resolvedReason =
    reasonChoice === CLOSE_REASON_OTHER
      ? customReason.trim()
      : reasonChoice ?? '';

  async function handleConfirm() {
    setSaving(true);
    try {
      await onConfirm({
        reason: resolvedReason.trim() || null,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            Cerrar conversación
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Indica el motivo del cierre (opcional).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Motivo */}
          <div className="space-y-2">
            <Label>Motivo de cierre</Label>
            <div className="flex flex-wrap gap-2">
              {reasonOptions.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() =>
                    setReasonChoice((prev) => (prev === reason ? null : reason))
                  }
                  aria-pressed={reasonChoice === reason}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    reasonChoice === reason
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {reason}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  setReasonChoice((prev) =>
                    prev === CLOSE_REASON_OTHER ? null : CLOSE_REASON_OTHER,
                  )
                }
                aria-pressed={reasonChoice === CLOSE_REASON_OTHER}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm transition-colors',
                  reasonChoice === CLOSE_REASON_OTHER
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {CLOSE_REASON_OTHER}
              </button>
            </div>
            {reasonChoice === CLOSE_REASON_OTHER ? (
              <Input
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Escribe el motivo"
                maxLength={120}
                autoFocus
              />
            ) : null}
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Cerrando…
              </>
            ) : (
              'Cerrar conversación'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
