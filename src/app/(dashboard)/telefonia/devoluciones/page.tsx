'use client';

// ============================================================
// Devoluciones de llamadas perdidas (migración 122).
//
// Toda entrante que no se contesta deja una solicitud de devolución
// (timeout de cola, rechazo del agente o cuelgue antes de contestar).
// El agente la reclama, marca desde el softphone y la cierra con la
// llamada saliente vinculada. También se pueden registrar a mano.
//
// La cola es compartida: si dos agentes pulsan Llamar a la vez, el
// UPDATE atómico deja la solicitud solo al primero.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  PhoneCall,
  Plus,
  RefreshCw,
  Undo2,
  XCircle,
} from 'lucide-react';

import { Panel } from '@/components/metrics/panel';
import { useTelephony } from '@/components/telephony/telephony-provider';
import { Badge } from '@/components/ui/badge';
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
import { formatPhoneDisplay } from '@/lib/telephony/phone';
import { cn } from '@/lib/utils';
import {
  callbackReasonLabel,
  callbackStatusLabel,
  type CallbackRequest,
} from '@/types';

type TabKey = 'pending' | 'in_progress' | 'closed';

/** Cada cuánto se refresca la cola mientras la página está abierta. */
const POLL_MS = 20_000;

const TABS: { key: TabKey; label: string }[] = [
  { key: 'pending', label: 'Pendientes' },
  { key: 'in_progress', label: 'En curso' },
  { key: 'closed', label: 'Cerradas' },
];

export default function CallbacksPage() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { startCall, callable } = useTelephony();

  const [callbacks, setCallbacks] = useState<CallbackRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/telephony/callbacks', {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as {
        callbacks?: CallbackRequest[];
        migrationMissing?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? 'No se pudieron cargar las devoluciones.');
        return;
      }
      setError(null);
      setMigrationMissing(Boolean(body.migrationMissing));
      setCallbacks(body.callbacks ?? []);
    } catch {
      setError('Sin conexión: no se pudieron cargar las devoluciones.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (migrationMissing) return;
    const timer = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [load, migrationMissing]);

  const grouped = useMemo(() => {
    const pending = callbacks.filter((row) => row.status === 'pending');
    const inProgress = callbacks.filter((row) => row.status === 'in_progress');
    const closed = callbacks
      .filter((row) => row.status === 'done' || row.status === 'cancelled')
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { pending, in_progress: inProgress, closed };
  }, [callbacks]);

  const rows = grouped[tab];

  const applyUpdate = (updated: CallbackRequest) => {
    setCallbacks((current) =>
      current.map((row) => (row.id === updated.id ? updated : row))
    );
  };

  const action = async (
    id: string,
    path: string
  ): Promise<CallbackRequest | null> => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/telephony/callbacks/${id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as {
        callback?: CallbackRequest;
        error?: string;
      };
      if (!res.ok || !body.callback) {
        toast.error(body.error ?? 'No se pudo actualizar la devolución.');
        return null;
      }
      applyUpdate(body.callback);
      return body.callback;
    } catch {
      toast.error('Sin conexión con el servidor.');
      return null;
    } finally {
      setBusyId(null);
    }
  };

  /** Reclama (si hace falta), marca y cierra con la llamada vinculada. */
  const callBack = async (row: CallbackRequest) => {
    let current = row;
    if (row.status === 'pending') {
      const claimed = await action(row.id, 'claim');
      if (!claimed) return;
      current = claimed;
    }

    const call = await startCall(
      current.phone,
      current.contact_id ? { contactId: current.contact_id } : undefined
    );
    if (!call) {
      toast.error(
        'No se pudo iniciar la llamada. La devolución quedó en curso; puedes liberarla.'
      );
      return;
    }

    setBusyId(current.id);
    try {
      const res = await fetch(
        `/api/telephony/callbacks/${current.id}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callSessionId: call.id }),
        }
      );
      const body = (await res.json().catch(() => ({}))) as {
        callback?: CallbackRequest;
        error?: string;
      };
      if (!res.ok || !body.callback) {
        toast.error(
          body.error ??
            'La llamada salió, pero no se pudo cerrar la devolución.'
        );
        return;
      }
      applyUpdate(body.callback);
      toast.success('Llamada iniciada y devolución atendida.');
    } finally {
      setBusyId(null);
    }
  };

  const createManual = async () => {
    if (!phone.trim()) {
      toast.error('Escribe el número a devolver.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/telephony/callbacks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), note: note.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        callback?: CallbackRequest;
        error?: string;
      };
      if (!res.ok || !body.callback) {
        toast.error(body.error ?? 'No se pudo registrar la devolución.');
        return;
      }
      setCallbacks((current) => [...current, body.callback as CallbackRequest]);
      setPhone('');
      setNote('');
      setAddOpen(false);
      setTab('pending');
      toast.success('Devolución registrada.');
    } finally {
      setCreating(false);
    }
  };

  if (authLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-lg font-semibold">
            Devoluciones de llamadas
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Cola compartida de clientes que quedaron sin respuesta. Reclama una,
            marca desde el softphone y el sistema la cierra con la llamada
            saliente. Las entrantes perdidas se registran solas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            Actualizar
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Registrar devolución
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-300/60 bg-red-50 p-4 text-red-800 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      ) : null}

      {migrationMissing ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">
            Aplica la migración 122_callback_requests.sql para guardar las
            devoluciones. Hasta entonces la cola aparecerá vacía.
          </p>
        </div>
      ) : null}

      {!callable && !migrationMissing ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">
            La telefonía aún no puede marcar, así que las devoluciones se pueden
            reclamar y cerrar a mano, pero el botón Llamar fallará hasta
            configurar LiveKit y la troncal SIP.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border p-1">
        {TABS.map((item) => {
          const count =
            item.key === 'pending'
              ? grouped.pending.length
              : item.key === 'in_progress'
                ? grouped.in_progress.length
                : grouped.closed.length;
          return (
            <Button
              key={item.key}
              variant={tab === item.key ? 'default' : 'ghost'}
              size="sm"
              className={cn(
                tab === item.key && 'bg-primary text-primary-foreground'
              )}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              <span className="ml-1.5 text-[11px] opacity-70">{count}</span>
            </Button>
          );
        })}
      </div>

      <Panel bodyClassName="p-0">
        {loading && callbacks.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando devoluciones…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">
            {tab === 'pending'
              ? 'No hay devoluciones pendientes. Buena señal.'
              : tab === 'in_progress'
                ? 'Nadie tiene una devolución en curso.'
                : 'Todavía no hay devoluciones cerradas.'}
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => {
              const mine = row.assigned_user_id === user?.id;
              const busy = busyId === row.id;
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-start justify-between gap-3 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-foreground font-medium">
                        {row.contact?.name ||
                          formatPhoneDisplay(row.phone) ||
                          row.phone}
                      </p>
                      <Badge variant="secondary">
                        {callbackReasonLabel(row.reason)}
                      </Badge>
                      <Badge
                        variant={
                          row.status === 'done'
                            ? 'default'
                            : row.status === 'cancelled'
                              ? 'destructive'
                              : 'outline'
                        }
                      >
                        {callbackStatusLabel(row.status)}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span>{formatPhoneDisplay(row.phone) || row.phone}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(row.created_at), {
                          addSuffix: true,
                          locale: es,
                        })}
                      </span>
                      {row.assigned_name ? (
                        <span>Asignada a {row.assigned_name}</span>
                      ) : null}
                      {row.status === 'done' && row.completed_at ? (
                        <span>
                          Atendida{' '}
                          {format(new Date(row.completed_at), 'd MMM HH:mm', {
                            locale: es,
                          })}
                        </span>
                      ) : null}
                      {row.call_session_id ? (
                        <span>Con llamada vinculada</span>
                      ) : null}
                    </div>
                    {row.note ? (
                      <p className="text-muted-foreground mt-1.5 text-sm">
                        {row.note}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {row.status === 'pending' ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void callBack(row)}
                          disabled={busy}
                        >
                          {busy ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <PhoneCall className="mr-1 h-3.5 w-3.5" />
                          )}
                          Llamar
                        </Button>
                        {isAdmin ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => void action(row.id, 'cancel')}
                          >
                            <XCircle className="mr-1 h-3.5 w-3.5" />
                            Cancelar
                          </Button>
                        ) : null}
                      </>
                    ) : null}

                    {row.status === 'in_progress' && mine ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void callBack(row)}
                          disabled={busy}
                        >
                          {busy ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <PhoneCall className="mr-1 h-3.5 w-3.5" />
                          )}
                          Llamar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void action(row.id, 'complete')}
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                          Completar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => void action(row.id, 'release')}
                        >
                          <Undo2 className="mr-1 h-3.5 w-3.5" />
                          Liberar
                        </Button>
                      </>
                    ) : null}

                    {row.status === 'in_progress' && !mine ? (
                      <>
                        <span className="text-muted-foreground text-xs">
                          {row.assigned_name
                            ? `En curso por ${row.assigned_name}`
                            : 'En curso'}
                        </span>
                        {isAdmin ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void action(row.id, 'release')}
                            >
                              <Undo2 className="mr-1 h-3.5 w-3.5" />
                              Liberar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void action(row.id, 'cancel')}
                            >
                              <XCircle className="mr-1 h-3.5 w-3.5" />
                              Cancelar
                            </Button>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar devolución</DialogTitle>
            <DialogDescription>
              Para cuando el cliente pidió que lo llamen o la llamada se atendió
              por fuera del CRM. Si el número existe en contactos, se vincula
              solo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="callback-phone">Teléfono</Label>
              <Input
                id="callback-phone"
                placeholder="0412 123 4567 o +58 412 123 4567"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="callback-note">Nota (opcional)</Label>
              <Textarea
                id="callback-note"
                rows={3}
                maxLength={500}
                placeholder="Qué pidió o qué hay que responderle"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
              disabled={creating}
            >
              Cancelar
            </Button>
            <Button onClick={() => void createManual()} disabled={creating}>
              {creating ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1 h-3.5 w-3.5" />
              )}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
