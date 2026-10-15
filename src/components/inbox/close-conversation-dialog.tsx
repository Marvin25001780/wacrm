'use client';

// ============================================================
// CloseConversationDialog
//
// Al cerrar una conversación desde la Bandeja se pide:
//   1. El motivo de cierre (catálogo + texto libre para "Otro").
//   2. Opcionalmente, el CSAT (1..5 estrellas + comentario).
//
// El diálogo solo recolecta la información; la persistencia la hace
// el padre (MessageThread) para no duplicar la lógica de Supabase.
// ============================================================

import { useEffect, useState } from 'react';
import { Loader2, Star } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { CLOSE_REASON_OTHER, CLOSE_REASONS } from '@/lib/inbox/close-reasons';

export interface CloseConversationPayload {
  /** Motivo de cierre (null si no se eligió ninguno). */
  reason: string | null;
  /** CSAT 1..5, solo si el agente lo registró. */
  score?: number;
  comment?: string;
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
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
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
    setScore(null);
    setComment('');
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
        score: score ?? undefined,
        comment: comment.trim() || undefined,
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
            Indica el motivo del cierre. Registrar la satisfacción (CSAT) es
            opcional.
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

          {/* CSAT */}
          <div className="space-y-2">
            <Label>Satisfacción del cliente (opcional)</Label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScore((prev) => (prev === value ? null : value))}
                  aria-label={`${value} de 5`}
                  aria-pressed={(score ?? 0) >= value}
                  className="rounded-md p-0.5 transition-transform hover:scale-110"
                >
                  <Star
                    className={cn(
                      'size-6',
                      (score ?? 0) >= value
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-muted-foreground',
                    )}
                  />
                </button>
              ))}
              {score ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {score} / 5
                </span>
              ) : null}
            </div>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Comentario del cliente (opcional)"
              maxLength={400}
              rows={2}
            />
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
