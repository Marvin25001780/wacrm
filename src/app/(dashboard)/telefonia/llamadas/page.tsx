'use client';

// ============================================================
// Historial de llamadas — búsqueda, filtros y paginación.
//
// /telefonia muestra las últimas llamadas del día a día; esta pantalla
// es la que se usa para encontrar una llamada concreta (un número, un
// agente, un resultado, un rango de días) y revisar su detalle sin
// salir del CRM. Es solo lectura: se apoya en
// GET /api/telephony/calls con los filtros validados en
// `lib/telephony/history.ts`.
//
// La búsqueda por texto acepta número (se compara por los últimos 7
// dígitos, así "0412…" encuentra "+58412…") o nombre del contacto.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PhoneCall,
  Search,
  X,
} from 'lucide-react';

import { Panel } from '@/components/metrics/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import {
  HISTORY_DAYS,
  HISTORY_PAGE_SIZES,
  hasHistoryFilters,
  historyQuery,
  parseHistoryFilters,
  type HistoryFilters,
} from '@/lib/telephony/history';
import { formatCallDuration } from '@/lib/telephony/calls';
import { formatPhoneDisplay } from '@/lib/telephony/phone';
import { cn } from '@/lib/utils';
import {
  CALL_DIRECTIONS,
  CALL_DISPOSITIONS,
  CALL_SESSION_STATUSES,
  callDirectionLabel,
  callDispositionLabel,
  callSessionStatusLabel,
  type CallSession,
} from '@/types';

interface HistoryCall extends CallSession {
  agent_name?: string | null;
  contact?: { id: string; name: string | null; phone: string | null } | null;
}

const STATUS_BADGE: Record<string, string> = {
  ringing: 'border-primary/40 bg-primary/10 text-primary dark:bg-primary/15',
  active: 'border-primary/40 bg-primary/10 text-primary dark:bg-primary/15',
  ended:
    'border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  missed:
    'border-amber-300/60 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  failed:
    'border-red-300/60 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  cancelled: 'border-border text-muted-foreground',
};

function formatMoment(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'dd/MM/yy HH:mm', { locale: es });
}

function counterpartNumber(call: HistoryCall): string {
  const raw = call.direction === 'inbound' ? call.from_number : call.to_number;
  return raw ? formatPhoneDisplay(raw) : '—';
}

export default function CallHistoryPage() {
  const { accountRole, loading: authLoading } = useAuth();
  const canView = accountRole === 'owner' || accountRole === 'admin' || accountRole === 'agent';

  const [filters, setFilters] = useState<HistoryFilters>(() =>
    parseHistoryFilters(new URLSearchParams())
  );
  const [qInput, setQInput] = useState('');
  const [calls, setCalls] = useState<HistoryCall[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryCall | null>(null);
  const [members, setMembers] = useState<{ user_id: string; name: string }[]>([]);

  const query = useMemo(() => historyQuery(filters), [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/telephony/calls?${query}`, {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as {
        calls?: HistoryCall[];
        hasMore?: boolean;
        error?: string;
      };
      if (!res.ok || !body.calls) {
        setError(body.error ?? 'No se pudo cargar el historial.');
        setCalls([]);
        setHasMore(false);
        return;
      }
      setCalls(body.calls);
      setHasMore(Boolean(body.hasMore));
    } catch {
      setError('Sin conexión: no se pudo cargar el historial.');
      setCalls([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (!canView) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [canView, load]);

  // El selector de agente necesita el roster del negocio. Son nombres,
  // no datos sensibles: el endpoint los devuelve a cualquier miembro.
  useEffect(() => {
    if (!canView) return;
    const loadMembers = async () => {
      try {
        const res = await fetch('/api/account/members', { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as {
          members?: Array<{
            user_id: string;
            full_name?: string | null;
            display_name?: string | null;
          }>;
        };
        if (!res.ok || !body.members) return;
        setMembers(
          body.members.map((member) => ({
            user_id: member.user_id,
            name:
              member.display_name ||
              member.full_name ||
              'Miembro',
          }))
        );
      } catch {
        // Sin roster el filtro de agente queda en "Todos".
      }
    };
    void loadMembers();
  }, [canView]);

  const apply = (patch: Partial<HistoryFilters>) => {
    setFilters((current) => ({ ...current, ...patch, offset: 0 }));
  };

  const reset = () => {
    setQInput('');
    setFilters(parseHistoryFilters(new URLSearchParams()));
  };

  if (authLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="space-y-5">
        <h2 className="text-foreground text-lg font-semibold">
          Historial de llamadas
        </h2>
        <div className="border-border text-muted-foreground rounded-xl border p-6 text-sm">
          Solo agentes, administradores y el dueño pueden ver el historial de
          llamadas.
        </div>
      </div>
    );
  }

  const page = Math.floor(filters.offset / filters.limit) + 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-lg font-semibold">
            Historial de llamadas
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Busca por número o por nombre del contacto y acota por
            dirección, estado, resultado o agente. Las fechas están en hora
            de Venezuela.
          </p>
        </div>
        {hasHistoryFilters(filters) ? (
          <Button variant="outline" size="sm" onClick={reset}>
            <X className="mr-1.5 h-3.5 w-3.5" /> Limpiar filtros
          </Button>
        ) : null}
      </div>

      <Panel title="Filtros">
        <div className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              apply({ q: qInput.trim().slice(0, 60) });
            }}
          >
            <div className="min-w-[220px] flex-1 space-y-1.5">
              <Label htmlFor="history-q">Número o contacto</Label>
              <Input
                id="history-q"
                placeholder="0412…, +58… o nombre"
                value={qInput}
                onChange={(event) => setQInput(event.target.value)}
              />
            </div>
            <Button type="submit" className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Search className="mr-1.5 h-4 w-4" /> Buscar
            </Button>
          </form>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="history-direction">Dirección</Label>
              <select
                id="history-direction"
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={filters.direction}
                onChange={(event) =>
                  apply({
                    direction: event.target.value as HistoryFilters['direction'],
                  })
                }
              >
                <option value="">Todas</option>
                {CALL_DIRECTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="history-status">Estado</Label>
              <select
                id="history-status"
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={filters.status}
                onChange={(event) =>
                  apply({ status: event.target.value as HistoryFilters['status'] })
                }
              >
                <option value="">Todos</option>
                {CALL_SESSION_STATUSES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="history-disposition">Resultado</Label>
              <select
                id="history-disposition"
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={filters.disposition}
                onChange={(event) =>
                  apply({
                    disposition: event.target.value as HistoryFilters['disposition'],
                  })
                }
              >
                <option value="">Todos</option>
                {CALL_DISPOSITIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="history-agent">Agente</Label>
              <select
                id="history-agent"
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={filters.agent}
                onChange={(event) => apply({ agent: event.target.value })}
              >
                <option value="">Todos</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="history-days">Periodo</Label>
              <select
                id="history-days"
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={filters.days}
                onChange={(event) => apply({ days: Number(event.target.value) })}
              >
                {HISTORY_DAYS.map((days) => (
                  <option key={days} value={days}>
                    {days === 0 ? 'Todo el historial' : `Últimos ${days} días`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </Panel>

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-300/60 bg-red-50 p-4 text-red-800 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      ) : null}

      <Panel
        title="Llamadas"
        subtitle={
          loading
            ? 'Cargando…'
            : `${calls.length} en esta página${hasMore ? ' · hay más' : ''}`
        }
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando historial…
          </div>
        ) : calls.length === 0 ? (
          <div className="p-6">
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <PhoneCall className="h-4 w-4" />
              {hasHistoryFilters(filters)
                ? 'Ninguna llamada coincide con estos filtros.'
                : 'Todavía no hay llamadas en este negocio.'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inicio</TableHead>
                <TableHead>Dirección</TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead>Agente</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Duración</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Registro</TableHead>
                <TableHead className="text-right">Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((call) => (
                <TableRow key={call.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatMoment(call.started_at)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {callDirectionLabel(call.direction)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {counterpartNumber(call)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {call.contact?.name ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {call.agent_name ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(STATUS_BADGE[call.status])}
                    >
                      {callSessionStatusLabel(call.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatCallDuration(call.duration_seconds)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {call.disposition ? (
                      callDispositionLabel(call.disposition)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {call.recording_url ? (
                      <span className="text-emerald-700 dark:text-emerald-300">
                        Grabada
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDetail(call)}
                    >
                      Ver
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
          <p className="text-muted-foreground text-xs">
            Página {page}
            {hasMore ? ' · hay más resultados' : ' · fin del historial'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={filters.offset === 0 || loading}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  offset: Math.max(0, current.offset - current.limit),
                }))
              }
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore || loading}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  offset: current.offset + current.limit,
                }))
              }
            >
              Siguiente <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
            <select
              aria-label="Llamadas por página"
              className="border-input bg-background h-8 rounded-md border px-2 text-xs"
              value={filters.limit}
              onChange={(event) => apply({ limit: Number(event.target.value) })}
            >
              {HISTORY_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} por página
                </option>
              ))}
            </select>
          </div>
        </div>
      </Panel>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle de la llamada</DialogTitle>
            <DialogDescription>
              {detail
                ? `${callDirectionLabel(detail.direction)} · ${formatMoment(detail.started_at)}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {detail ? (
            <CallDetail
              call={detail}
              onTranscribe={
                detail.recording_url
                  ? async () => {
                      try {
                        const res = await fetch(
                          `/api/telephony/calls/${detail.id}/transcribe`,
                          { method: 'POST' }
                        );
                        const body = (await res.json().catch(() => ({}))) as {
                          call?: HistoryCall;
                          error?: string;
                        };
                        if (!res.ok || !body.call) {
                          toast.error(
                            body.error ?? 'No se pudo transcribir la llamada.'
                          );
                          return;
                        }
                        setDetail({ ...detail, ...body.call });
                        setCalls((current) =>
                          current.map((row) =>
                            row.id === body.call!.id ? { ...row, ...body.call! } : row
                          )
                        );
                        toast.success('Transcripción lista.');
                      } catch {
                        toast.error('Sin conexión con el servidor.');
                      }
                    }
                  : null
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Cuerpo del detalle. Solo lectura salvo la transcripción, que el
 * agente puede pedir si la llamada tiene grabación.
 */
function CallDetail({
  call,
  onTranscribe,
}: {
  call: HistoryCall;
  onTranscribe: (() => Promise<void>) | null;
}) {
  const transcriptLabels: Record<string, string> = {
    none: 'Sin transcribir',
    pending: 'En cola',
    processing: 'Transcribiendo',
    done: 'Transcrita',
    failed: 'Error al transcribir',
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Número" value={counterpartNumber(call)} mono />
        <Field label="Contacto" value={call.contact?.name ?? 'Sin contacto'} />
        <Field label="Agente" value={call.agent_name ?? 'Sin agente'} />
        <Field
          label="Duración"
          value={formatCallDuration(call.duration_seconds)}
        />
        <Field label="Estado" value={callSessionStatusLabel(call.status)} />
        <Field
          label="Resultado"
          value={
            call.disposition ? callDispositionLabel(call.disposition) : 'Sin clasificar'
          }
        />
        <Field label="Inicio" value={formatMoment(call.started_at)} />
        <Field label="Fin" value={formatMoment(call.ended_at)} />
        {call.transfer_count > 0 ? (
          <Field
            label="Transferencias"
            value={String(call.transfer_count)}
          />
        ) : null}
      </div>

      {call.recording_url ? (
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">Grabación</p>
          <audio controls src={call.recording_url} className="w-full" />
        </div>
      ) : null}

      {call.notes ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">
            Notas del agente
          </p>
          <p className="text-foreground whitespace-pre-wrap text-sm">
            {call.notes}
          </p>
        </div>
      ) : null}

      {call.ai_summary ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">
            Resumen con IA
          </p>
          <p className="text-foreground whitespace-pre-wrap text-sm">
            {call.ai_summary}
          </p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs font-medium">
            Transcripción ·{' '}
            {transcriptLabels[call.transcript_status] ?? call.transcript_status}
          </p>
          {onTranscribe && call.transcript_status !== 'done' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onTranscribe()}
            >
              Transcribir
            </Button>
          ) : null}
        </div>
        {call.transcript ? (
          <pre className="border-border bg-muted/40 max-h-64 overflow-auto rounded-lg border p-3 text-xs whitespace-pre-wrap">
            {call.transcript}
          </pre>
        ) : (
          <p className="text-muted-foreground text-sm">
            {call.recording_url
              ? 'Todavía no hay transcripción para esta llamada.'
              : 'La llamada no tiene grabación, así que no se puede transcribir.'}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground text-[11px] font-medium">{label}</p>
      <p className={cn('text-foreground text-sm', mono && 'font-mono')}>
        {value}
      </p>
    </div>
  );
}
