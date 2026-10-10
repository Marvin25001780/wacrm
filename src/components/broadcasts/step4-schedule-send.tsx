'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save, CalendarClock } from 'lucide-react';

interface AudienciaConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienciaConfig;
  onSend: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
  /** `datetime-local` string; vacío = enviar ya. */
  scheduledAt: string;
  onScheduledAtChange: (value: string) => void;
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
  scheduledAt,
  onScheduledAtChange,
}: Step4Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);
  const [mode, setMode] = useState<'now' | 'later'>(scheduledAt ? 'later' : 'now');

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          setEstimatedReach(count ?? 0);
        } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set((contactTags ?? []).map((ct) => ct.contact_id));
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  const audienceLabel =
    audience.type === 'all'
      ? 'Todos los Contactos'
      : audience.type === 'tags'
        ? `Tags (${audience.tagIds?.length ?? 0} selected)`
        : audience.type === 'csv'
          ? 'Carga CSV'
          : 'Personalizado';

  const minLocal = toLocalInputValue(new Date(Date.now() + 60 * 1000));

  function chooseMode(next: 'now' | 'later') {
    setMode(next);
    if (next === 'now') {
      onScheduledAtChange('');
    } else if (!scheduledAt) {
      onScheduledAtChange(toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)));
    }
  }

  const scheduleValid =
    mode === 'now' ||
    (Boolean(scheduledAt) && new Date(scheduledAt).getTime() > Date.now());

  const canSubmit = Boolean(name.trim()) && !isProcessing && scheduleValid;

  const scheduledLabel = scheduledAt
    ? new Date(scheduledAt).toLocaleString('es', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Revisar y Enviar</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Nombra tu transmisión, revisa los detalles y envíala o prográmala.
        </p>
      </div>

      {/* Nombre de la Transmisión */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">Nombre de la Transmisión</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="ej. Anuncio de Venta de Verano"
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Resumen Card */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">Resumen</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Plantilla</p>
            <p className="text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Audiencia</p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Alcance Estimado</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-foreground">{estimatedReach.toLocaleString()}</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Idioma</p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {/* Programación */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CalendarClock className="h-4 w-4 text-primary" />
          Programación
        </p>
        <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
          <button
            type="button"
            onClick={() => chooseMode('now')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'now'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Enviar ahora
          </button>
          <button
            type="button"
            onClick={() => chooseMode('later')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'later'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Programar
          </button>
        </div>

        {mode === 'later' && (
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Fecha y hora de envío
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              min={minLocal}
              onChange={(e) => onScheduledAtChange(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring"
            />
            {!scheduleValid && (
              <p className="mt-1.5 text-xs text-rose-400">
                Elige una fecha y hora futuras.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">
                {mode === 'later' ? 'Programando...' : 'Enviando transmisión...'}
              </p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Atrás
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Guardar como Borrador
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogTrigger
            render={
              <Button
                disabled={!canSubmit}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              />
            }
          >
            {mode === 'later' ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {mode === 'later' ? 'Programar Transmisión' : 'Enviar Transmisión'}
          </DialogTrigger>
          <DialogContent className="border-border bg-popover sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {mode === 'later' ? 'Confirmar Programación' : 'Confirmar Transmisión'}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {mode === 'later' ? (
                  <>
                    Se programará una transmisión a{' '}
                    <span className="font-medium text-popover-foreground">
                      {estimatedReach.toLocaleString()}
                    </span>{' '}
                    contactos con la plantilla{' '}
                    <span className="font-medium text-popover-foreground">{template.name}</span> para
                    el{' '}
                    <span className="font-medium text-popover-foreground">{scheduledLabel}</span>.
                  </>
                ) : (
                  <>
                    Estás a punto de enviar esta transmisión a{' '}
                    <span className="font-medium text-popover-foreground">
                      {estimatedReach.toLocaleString()}
                    </span>{' '}
                    contactos usando la plantilla{' '}
                    <span className="font-medium text-popover-foreground">{template.name}</span>.
                    Esta acción no se puede deshacer.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfirm(false)}
                className="border-border text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setShowConfirm(false);
                  onSend();
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {mode === 'later' ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {mode === 'later' ? 'Confirmar y Programar' : 'Confirmar y Enviar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
}
