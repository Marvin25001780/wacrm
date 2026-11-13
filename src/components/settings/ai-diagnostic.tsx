'use client';

// ============================================================
// Diagnóstico del agente de IA.
//
// Muestra, en una sola tarjeta, todas las condiciones que pueden
// dejar al bot en silencio: interruptores, clave, canal, agente,
// automatizaciones y estado de los últimos hilos. Sirve para
// responder "¿por qué no contesta?" sin revisar la base de datos.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  AiDiagnostic,
  DiagnosticStatus,
} from '@/lib/ai/diagnostic';

const STATUS_META: Record<
  DiagnosticStatus,
  { icon: typeof CheckCircle2; className: string; label: string }
> = {
  ok: {
    icon: CheckCircle2,
    className: 'text-emerald-500',
    label: 'Correcto',
  },
  warn: {
    icon: AlertCircle,
    className: 'text-amber-500',
    label: 'Atención',
  },
  fail: {
    icon: XCircle,
    className: 'text-destructive',
    label: 'Bloqueado',
  },
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const REASON_LABEL: Record<string, string> = {
  replied: 'Respondió y el mensaje salió por WhatsApp.',
  no_config: 'No hay proveedor de IA configurado.',
  auto_reply_disabled: 'Las respuestas automáticas están apagadas.',
  conversation_not_found: 'No se encontró la conversación.',
  channel_not_covered: 'El agente no tiene marcado el canal de este hilo.',
  automation_owns_messages:
    'Una automatización activa está interceptando los mensajes.',
  assigned_to_human: 'El hilo está asignado a un humano.',
  max_replies_reached: 'El hilo llegó al máximo de respuestas del bot.',
  processing_lock: 'Hay otro intento en curso o quedó un bloqueo reciente.',
  audio_not_transcribed:
    'El último mensaje es una nota de voz que no se pudo transcribir.',
  empty_context: 'El hilo no tiene texto para responder.',
  handoff: 'El agente decidió derivar a un humano.',
  slot_not_claimed: 'No se pudo reservar el turno del bot.',
  error: 'El motor falló antes de enviar.',
};

export function AiDiagnosticPanel() {
  const [diagnostic, setDiagnostic] = useState<AiDiagnostic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [replyResults, setReplyResults] = useState<
    Record<
      string,
      { replied: boolean; reason: string; detail?: string }
    >
  >({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    | {
        kind: 'ok';
        reply: string;
        handoff: boolean;
        agent: string | null;
        model: string;
      }
    | { kind: 'error'; error: string; code?: string }
    | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/diagnostic');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo cargar el diagnóstico.');
        return;
      }
      setDiagnostic(data as AiDiagnostic);
    } catch {
      setError('No se pudo cargar el diagnóstico.');
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const failing = diagnostic?.checks.filter((c) => c.status === 'fail') ?? [];
  const targetConversation =
    diagnostic?.conversations.find((conv) => !conv.answered) ?? null;

  async function replyNow(conversationId: string) {
    setReplying(conversationId);
    try {
      const res = await fetch('/api/ai/diagnostic/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReplyResults((prev) => ({
          ...prev,
          [conversationId]: {
            replied: false,
            reason: 'error',
            detail: data.error ?? 'No se pudo ejecutar el motor.',
          },
        }));
        return;
      }
      setReplyResults((prev) => ({
        ...prev,
        [conversationId]: {
          replied: Boolean(data.replied),
          reason: String(data.reason ?? ''),
          detail:
            typeof data.detail === 'string' ? data.detail : undefined,
        },
      }));
      if (data.replied) {
        toast.success('Mensaje enviado al cliente.');
        await load();
      }
    } catch {
      setReplyResults((prev) => ({
        ...prev,
        [conversationId]: {
          replied: false,
          reason: 'error',
          detail: 'No se pudo contactar al servidor.',
        },
      }));
    } finally {
      setReplying(null);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/ai/diagnostic/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          targetConversation ? { conversation_id: targetConversation.id } : {},
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTestResult({
          kind: 'error',
          error: data.error ?? 'El proveedor no respondió.',
          code: data.code,
        });
        return;
      }
      setTestResult({
        kind: 'ok',
        reply: data.reply ?? '',
        handoff: Boolean(data.handoff),
        agent: data.agent ?? null,
        model: data.model ?? '',
      });
    } catch {
      setTestResult({
        kind: 'error',
        error: 'No se pudo contactar al proveedor de IA.',
      });
    } finally {
      setTesting(false);
    }
  }

  async function resetConversation(conversationId: string) {
    setResetting(conversationId);
    try {
      const res = await fetch('/api/ai/diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo devolver el hilo al bot.');
        return;
      }
      toast.success('Hilo devuelto al bot. El próximo mensaje se responderá.');
      await load();
    } catch {
      toast.error('No se pudo devolver el hilo al bot.');
    } finally {
      setResetting(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">
            ¿Por qué no responde el agente?
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Revisión en vivo de todo lo que puede dejar al bot en silencio.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="shrink-0"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Revisar
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {loading && !diagnostic && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Revisando…
          </div>
        )}

        {diagnostic && (
          <>
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-sm',
                diagnostic.ok
                  ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
              )}
            >
              {diagnostic.ok
                ? 'Todo listo: la IA tiene proveedor, canal y permiso para responder.'
                : `Hay ${failing.length} bloqueo(s). Corrige lo marcado en rojo y el bot volverá a contestar.`}
            </div>

            <ul className="space-y-2">
              {diagnostic.checks.map((check) => {
                const meta = STATUS_META[check.status];
                const Icon = meta.icon;
                return (
                  <li
                    key={check.id}
                    className="flex items-start gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', meta.className)} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {check.label}
                        </p>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {check.detail}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Prueba real de la IA
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {targetConversation
                      ? 'Genera una respuesta con el último mensaje del hilo más reciente. No se envía al cliente.'
                      : 'Genera una respuesta de prueba con un mensaje de ejemplo. No se envía a nadie.'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runTest()}
                  disabled={testing}
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Probar respuesta
                </Button>
              </div>

              {testResult?.kind === 'error' && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                  <p className="font-medium text-destructive">
                    El proveedor rechazó la llamada
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-destructive/90">
                    {testResult.error}
                  </p>
                  {testResult.code && (
                    <p className="mt-1 text-[11px] text-destructive/70">
                      Código: {testResult.code}
                    </p>
                  )}
                  {/model/i.test(testResult.error) && (
                    <p className="mt-2 text-xs text-destructive/90">
                      Revisa el nombre del modelo en «Proveedor y clave». El
                      campo admite el ID exacto del proveedor, no el nombre
                      comercial.
                    </p>
                  )}
                  {/balance|quota|credit|insufficient/i.test(
                    testResult.error,
                  ) && (
                    <p className="mt-2 text-xs text-destructive/90">
                      La cuenta del proveedor se quedó sin saldo o cuota.
                    </p>
                  )}
                </div>
              )}

              {testResult?.kind === 'ok' && (
                <div className="rounded-md border border-emerald-600/30 bg-emerald-500/10 px-3 py-2">
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    Respuesta generada con {testResult.model}
                    {testResult.agent ? ` · agente «${testResult.agent}»` : ''}
                    {testResult.handoff ? ' · decidió derivar a un humano' : ''}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                    {testResult.reply ||
                      'El agente no escribió texto: el próximo mensaje se derivaría a un humano.'}
                  </p>
                </div>
              )}
            </div>

            {diagnostic.conversations.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Últimos hilos
                </p>
                <div className="divide-y divide-border rounded-md border border-border">
                  {diagnostic.conversations.map((conv) => (
                    <div key={conv.id} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {conv.contactName || conv.phone || 'Sin nombre'}
                        </p>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            conv.answered
                              ? 'border-emerald-600/40 text-emerald-600 dark:text-emerald-400'
                              : 'border-amber-600/40 text-amber-600 dark:text-amber-400',
                          )}
                        >
                          {conv.answered ? 'Respondido' : 'Sin respuesta'}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {conv.reason}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Cliente: {formatDate(conv.lastCustomerMessageAt)} · Bot:{' '}
                        {formatDate(conv.lastBotMessageAt)} · Respuestas del bot:{' '}
                        {conv.aiReplyCount}/{diagnostic.maxReplies}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void replyNow(conv.id)}
                          disabled={replying === conv.id}
                        >
                          {replying === conv.id ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ArrowRight className="mr-2 h-3.5 w-3.5" />
                          )}
                          Responder ahora
                        </Button>
                        {!conv.answered &&
                          (conv.assignedToHuman ||
                            conv.aiReplyCount >= diagnostic.maxReplies) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void resetConversation(conv.id)}
                              disabled={resetting === conv.id}
                            >
                              {resetting === conv.id ? (
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                              )}
                              Devolver al bot
                            </Button>
                          )}
                      </div>

                      {replyResults[conv.id] && (
                        <p
                          className={cn(
                            'mt-2 rounded-md px-2 py-1.5 text-xs',
                            replyResults[conv.id].replied
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
                          )}
                        >
                          {REASON_LABEL[replyResults[conv.id].reason] ??
                            replyResults[conv.id].reason}
                          {replyResults[conv.id].detail
                            ? ` — ${replyResults[conv.id].detail}`
                            : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
