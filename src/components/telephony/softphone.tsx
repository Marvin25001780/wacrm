'use client';

// ============================================================
// Softphone flotante — marcador, estado de agente y controles.
//
// No simula telefonía: si falta LiveKit/troncal muestra la lista de
// lo que falta. Cuando el servidor está listo, marca de verdad y
// registra la llamada en call_sessions + activities.
// ============================================================

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CircleDot,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  Radio,
  Settings2,
  X,
} from 'lucide-react';

import { useTelephony } from '@/components/telephony/telephony-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatPhoneDisplay } from '@/lib/telephony/phone';
import { formatCallDuration } from '@/lib/telephony/calls';
import {
  AGENT_STATUSES,
  agentStatusLabel,
  CALL_DISPOSITIONS,
  type AgentStatus,
  type CallDisposition,
} from '@/types';

export function Softphone() {
  const {
    status,
    loading,
    open,
    setOpen,
    phase,
    activeCall,
    elapsedLabel,
    muted,
    recording,
    error,
    notice,
    incomingCall,
    clearError,
    startCall,
    answerIncoming,
    declineIncoming,
    hangup,
    toggleMute,
    setAgentStatus,
    wrapUp,
    saveWrapUp,
    skipWrapUp,
  } = useTelephony();

  const [dial, setDial] = useState('');
  const [disposition, setDisposition] = useState<CallDisposition | ''>('');
  const [notes, setNotes] = useState('');
  const [savingWrapUp, setSavingWrapUp] = useState(false);

  if (!open) return null;

  const inCall = phase !== 'idle' && phase !== 'error';
  const busy = inCall || Boolean(wrapUp);
  const ready = Boolean(
    status?.dialReady && status.enabled && !status.migrationMissing
  );

  const submit = async () => {
    if (!dial.trim()) return;
    const ok = await startCall(dial.trim());
    if (ok) setDial('');
  };

  return (
    <div
      role="dialog"
      aria-label="Teléfono"
      className="border-border bg-card fixed right-4 bottom-4 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border shadow-2xl shadow-black/20"
    >
      <div className="border-border bg-primary text-primary-foreground flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-4 w-4" />
          <span className="text-sm font-semibold">Teléfono</span>
          {ready ? (
            <span
              className={cn(
                'ml-1 h-2 w-2 rounded-full',
                status?.presence.online ? 'bg-emerald-400' : 'bg-amber-300'
              )}
              title={status?.presence.online ? 'En línea' : 'Sin heartbeat'}
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cerrar teléfono"
          className="text-primary-foreground/80 hover:text-primary-foreground rounded-md p-1 transition-colors hover:bg-white/15"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 p-4">
        {loading ? (
          <p className="text-muted-foreground text-sm">
            Comprobando telefonía…
          </p>
        ) : null}

        {!loading && !ready ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <Settings2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1 text-xs">
                <p className="font-medium">Telefonía no configurada</p>
                <p>
                  {status?.blockReason ?? 'El servidor aún no tiene LiveKit.'}
                </p>
                {status?.missing?.length ? (
                  <p className="font-mono text-[11px] opacity-80">
                    Faltan: {status.missing.join(', ')}
                  </p>
                ) : null}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-border w-full"
              render={<Link href="/telefonia" />}
              onClick={() => setOpen(false)}
            >
              Ver configuración
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}

        {ready ? (
          <>
            {/* Estado del agente */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                  Mi estado
                </p>
                {status?.presence.online ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                    <CircleDot className="h-3 w-3" /> En línea
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">
                    Sin heartbeat
                  </span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {AGENT_STATUSES.map((option) => {
                  const active = status?.agentStatus === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void setAgentStatus(option.value as AgentStatus)
                      }
                      className={cn(
                        'rounded-md border px-1 py-1.5 text-[11px] font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                        busy && 'cursor-not-allowed opacity-50'
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {busy ? (
                <p className="text-muted-foreground mt-1 text-[11px]">
                  En llamada o en cierre: el estado se actualiza
                  automáticamente.
                </p>
              ) : null}
            </div>

            {error ? (
              <button
                type="button"
                onClick={clearError}
                className="w-full rounded-lg border border-red-300/60 bg-red-50 p-2 text-left text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300"
              >
                {error}
              </button>
            ) : null}
            {notice ? (
              <p className="border-border bg-muted/50 text-muted-foreground rounded-lg border p-2 text-xs">
                {notice}
              </p>
            ) : null}

            {incomingCall && !inCall ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 p-4 text-center dark:bg-emerald-950/30">
                  <p className="text-[11px] font-medium tracking-wider text-emerald-700 uppercase dark:text-emerald-300">
                    Llamada entrante
                  </p>
                  <p className="text-foreground mt-1 text-lg font-semibold">
                    {incomingCall.contact?.name ||
                      formatPhoneDisplay(incomingCall.from_number) ||
                      incomingCall.from_number ||
                      'Número desconocido'}
                  </p>
                  {incomingCall.contact?.name && incomingCall.from_number ? (
                    <p className="text-muted-foreground text-xs">
                      {formatPhoneDisplay(incomingCall.from_number)}
                    </p>
                  ) : null}
                  {incomingCall.to_number ? (
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      Marcó a {formatPhoneDisplay(incomingCall.to_number)}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-border h-11 flex-1"
                    onClick={() => void declineIncoming()}
                  >
                    <PhoneOff className="mr-1.5 h-4 w-4" />
                    Rechazar
                  </Button>
                  <Button
                    type="button"
                    className="h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() => void answerIncoming()}
                  >
                    <Phone className="mr-1.5 h-4 w-4" />
                    Contestar
                  </Button>
                </div>
              </div>
            ) : wrapUp ? (
              <div className="space-y-3">
                <div className="border-border bg-muted/30 rounded-xl border p-4 text-center">
                  <p className="text-muted-foreground text-[11px] tracking-wider uppercase">
                    Llamada finalizada
                  </p>
                  <p className="text-foreground mt-1 text-base font-semibold">
                    {formatPhoneDisplay(
                      wrapUp.call.direction === 'inbound'
                        ? wrapUp.call.from_number
                        : wrapUp.call.to_number
                    ) || '—'}
                  </p>
                  <p className="text-muted-foreground font-mono text-xs tabular-nums">
                    {formatCallDuration(wrapUp.seconds)} · clasifica la llamada
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="wrap-up-disposition"
                    className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase"
                  >
                    Disposición
                  </label>
                  <select
                    id="wrap-up-disposition"
                    value={disposition}
                    onChange={(event) =>
                      setDisposition(
                        event.target.value as CallDisposition | ''
                      )
                    }
                    className="border-border bg-background text-foreground h-9 w-full rounded-md border px-2 text-sm"
                  >
                    <option value="">Selecciona un resultado…</option>
                    {CALL_DISPOSITIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    rows={2}
                    placeholder="Notas del cierre (opcional)"
                    value={notes}
                    onChange={(event) =>
                      setNotes(event.target.value.slice(0, 2000))
                    }
                    className="border-border bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-border flex-1"
                    disabled={savingWrapUp}
                    onClick={() => {
                      setDisposition('');
                      setNotes('');
                      void skipWrapUp();
                    }}
                  >
                    Omitir
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1"
                    disabled={!disposition || savingWrapUp}
                    onClick={async () => {
                      if (!disposition) return;
                      setSavingWrapUp(true);
                      const ok = await saveWrapUp({
                        disposition,
                        notes: notes.trim() || null,
                      });
                      setSavingWrapUp(false);
                      if (ok) {
                        setDisposition('');
                        setNotes('');
                      }
                    }}
                  >
                    {savingWrapUp ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Guardar y disponible
                  </Button>
                </div>
              </div>
            ) : inCall ? (
              <div className="space-y-3">
                <div className="border-border bg-muted/30 rounded-xl border p-4 text-center">
                  <p className="text-muted-foreground text-[11px] tracking-wider uppercase">
                    {phase === 'connecting'
                      ? 'Conectando'
                      : phase === 'ringing'
                        ? 'Sonando'
                        : phase === 'ending'
                          ? 'Colgando'
                          : 'En llamada'}
                  </p>
                  <p className="text-foreground mt-1 text-lg font-semibold">
                    {formatPhoneDisplay(
                      activeCall?.direction === 'inbound'
                        ? activeCall?.from_number
                        : activeCall?.to_number
                    ) ||
                      (activeCall?.direction === 'inbound'
                        ? activeCall?.from_number
                        : activeCall?.to_number) ||
                      '—'}
                  </p>
                  <p className="text-foreground mt-1 font-mono text-2xl tabular-nums">
                    {phase === 'active' ? elapsedLabel : '--:--'}
                  </p>
                  {recording ? (
                    <Badge
                      variant="outline"
                      className="mt-2 border-red-300 text-[10px] text-red-600 dark:text-red-400"
                    >
                      <Radio className="mr-1 h-3 w-3 animate-pulse" />
                      Grabando
                    </Badge>
                  ) : null}
                </div>

                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => void toggleMute()}
                    aria-label={
                      muted ? 'Activar micrófono' : 'Silenciar micrófono'
                    }
                    className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-full border transition-colors',
                      muted
                        ? 'border-amber-400 bg-amber-100 text-amber-700 dark:bg-amber-950/40'
                        : 'border-border bg-card text-foreground hover:bg-muted'
                    )}
                  >
                    {muted ? (
                      <MicOff className="h-5 w-5" />
                    ) : (
                      <Mic className="h-5 w-5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void hangup()}
                    disabled={phase === 'ending'}
                    aria-label="Colgar"
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 disabled:opacity-60"
                  >
                    <PhoneOff className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label
                  htmlFor="softphone-number"
                  className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase"
                >
                  Marcar número
                </label>
                <div className="flex gap-2">
                  <input
                    id="softphone-number"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0412 123 4567"
                    value={dial}
                    onChange={(event) => setDial(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void submit();
                      }
                    }}
                    className="border-border bg-background text-foreground focus:border-primary focus:ring-primary/20 h-10 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus:ring-2"
                  />
                  <Button
                    type="button"
                    onClick={() => void submit()}
                    disabled={!dial.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-3"
                    aria-label="Llamar"
                  >
                    <Phone className="h-4 w-4" />
                  </Button>
                </div>
                <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                  <span>
                    {status?.callerId
                      ? `Sale como ${formatPhoneDisplay(status.callerId)}`
                      : 'Sale con el número de la troncal'}
                  </span>
                  <Link
                    href="/telefonia"
                    className="text-primary inline-flex items-center gap-0.5 hover:underline"
                    onClick={() => setOpen(false)}
                  >
                    Historial
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )}

            {status?.agentStatus && !busy ? (
              <p className="text-muted-foreground text-center text-[11px]">
                Estado actual: {agentStatusLabel(status.agentStatus)}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
