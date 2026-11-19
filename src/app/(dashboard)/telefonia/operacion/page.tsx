'use client';

// ============================================================
// Operación en vivo (bloque 124) — panel del supervisor.
//
// Muestra, sin recargar la página, la cola con su espera real y su
// estado de SLA, las transferencias que nadie aceptó y los agentes
// con el tiempo que llevan en su estado actual.
//
// El SLA es la espera máxima del negocio (`queue_max_wait_seconds`):
//   - sin límite (0): no hay alertas de SLA;
//   - por vencer al 80 % del máximo;
//   - vencida al llegar al máximo (el barrido la retira enseguida).
//
// No despacha ni contesta llamadas: para eso está el softphone. Este
// panel solo observa y avisa.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CircleDot,
  Clock,
  Headphones,
  Loader2,
  PhoneCall,
  PhoneIncoming,
  RefreshCw,
  Users,
} from 'lucide-react';

import { MetricCard } from '@/components/dashboard/metric-card';
import { Panel } from '@/components/metrics/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { formatCallDuration } from '@/lib/telephony/calls';
import {
  isLongStatus,
  longestWaitSeconds,
  queueSlaLabel,
  queueSlaState,
  queueWaitRealSeconds,
  secondsSince,
  transferSecondsLeft,
} from '@/lib/telephony/operations';
import { pauseReasonLabel } from '@/lib/telephony/adherence';
import { formatPhoneDisplay } from '@/lib/telephony/phone';
import { cn } from '@/lib/utils';
import {
  agentStatusLabel,
  type AgentStatus,
  type TelephonyOperations,
  type TelephonyOperationsAgent,
  type TelephonyOperationsQueueItem,
  type TelephonyPendingTransfer,
  type TelephonyQueueSla,
} from '@/types';

/** Cada cuánto se pide el estado al servidor. */
const REFRESH_MS = 5_000;

/**
 * Ventana para avisar de alguien marcado Disponible que se acaba de
 * desconectar. Fuera de ella se asume que terminó su jornada: evita
 * llenar el panel con miembros que no usan la telefonía.
 */
const RECENT_OFFLINE_MS = 15 * 60_000;

const ROLE_LABEL: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Admin',
  agent: 'Agente',
  viewer: 'Espectador',
};

const PRESENCE_LABEL: Record<string, string> = {
  online: 'Conectado',
  away: 'Ausente',
  offline: 'Desconectado',
};

const STATUS_DOT: Record<AgentStatus, string> = {
  available: 'bg-emerald-500',
  busy: 'bg-primary',
  wrap_up: 'bg-amber-500',
  break: 'bg-slate-400',
};

const SLA_BADGE: Record<TelephonyQueueSla, string> = {
  ok: 'border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  at_risk:
    'border-amber-300/60 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  expired:
    'border-red-300/60 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  none: 'border-border text-muted-foreground',
};

interface LiveQueueItem extends TelephonyOperationsQueueItem {
  sla: TelephonyQueueSla;
}

interface LiveAgent extends TelephonyOperationsAgent {
  status_seconds: number | null;
  call_seconds: number | null;
}

interface LiveTransfer extends TelephonyPendingTransfer {
  seconds_left: number | null;
}

interface LiveAlert {
  id: string;
  tone: 'danger' | 'warning';
  title: string;
  detail: string;
}

function displayNumber(value: string | null | undefined): string | null {
  const formatted = formatPhoneDisplay(value);
  return formatted || value || null;
}

function callLabel(item: {
  contact_name: string | null;
  from_number?: string | null;
  to_number?: string | null;
  number?: string | null;
}): string {
  return (
    item.contact_name ||
    displayNumber(item.from_number) ||
    displayNumber(item.number) ||
    displayNumber(item.to_number) ||
    'Número desconocido'
  );
}

export default function OperacionEnVivoPage() {
  const { accountRole, loading: authLoading } = useAuth();
  const canView = accountRole === 'admin' || accountRole === 'owner';

  const [data, setData] = useState<TelephonyOperations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/telephony/operations', {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as
        | TelephonyOperations
        | { error?: string };
      if (!res.ok) {
        setError(
          ('error' in body && body.error) ||
            'No se pudo cargar la operación en vivo.'
        );
        return;
      }
      setData(body as TelephonyOperations);
      setError(null);
    } catch {
      setError('Sin conexión: no se pudo actualizar el panel.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    // Carga inicial: el estado se actualiza cuando resuelve el fetch,
    // fuera de este render (mismo patrón que /telefonia/adherencia).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [canView, refresh]);

  useEffect(() => {
    if (!auto || !canView) return;
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, canView, refresh]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const queue: LiveQueueItem[] = useMemo(() => {
    const rows = data?.queue ?? [];
    const maxWaitSeconds = data?.queueMaxWaitSeconds ?? 0;
    return rows
      .map((item) => {
        const waitSeconds = queueWaitRealSeconds({
          startedAt: item.started_at,
          queuedAt: item.queued_at,
          now: nowTick,
        });
        return {
          ...item,
          wait_seconds: waitSeconds,
          sla: queueSlaState({ waitSeconds, maxWaitSeconds }),
        };
      })
      .sort((a, b) => b.priority - a.priority || b.wait_seconds - a.wait_seconds);
  }, [data, nowTick]);

  const agents: LiveAgent[] = useMemo(
    () =>
      (data?.agents ?? []).map((agent) => ({
        ...agent,
        status_seconds: secondsSince(agent.status_changed_at, nowTick),
        call_seconds: agent.active_call
          ? secondsSince(
              agent.active_call.answered_at ?? agent.active_call.started_at,
              nowTick
            )
          : null,
      })),
    [data, nowTick]
  );

  const transfers: LiveTransfer[] = useMemo(
    () =>
      (data?.transfers ?? []).map((transfer) => ({
        ...transfer,
        seconds_left: transferSecondsLeft({
          transferAt: transfer.transfer_at,
          timeoutSeconds: transfer.timeout_seconds,
          now: nowTick,
        }),
      })),
    [data, nowTick]
  );

  const alerts: LiveAlert[] = useMemo(() => {
    const list: LiveAlert[] = [];
    const maxWaitSeconds = data?.queueMaxWaitSeconds ?? 0;

    for (const item of queue) {
      if (item.sla === 'expired') {
        list.push({
          id: `queue-expired-${item.id}`,
          tone: 'danger',
          title: `Llamada de ${callLabel(item)} fuera de SLA`,
          detail: `${formatCallDuration(item.wait_seconds)} esperando; el máximo es ${formatCallDuration(maxWaitSeconds)}. La cola la retira en el próximo barrido.`,
        });
      } else if (item.sla === 'at_risk') {
        list.push({
          id: `queue-risk-${item.id}`,
          tone: 'warning',
          title: `Llamada de ${callLabel(item)} por vencer`,
          detail: `${formatCallDuration(item.wait_seconds)} esperando de ${formatCallDuration(maxWaitSeconds)}.`,
        });
      }
    }

    for (const transfer of transfers) {
      if (transfer.seconds_left == null) continue;
      if (transfer.seconds_left <= 5) {
        list.push({
          id: `transfer-${transfer.call_id}`,
          tone: transfer.seconds_left <= 0 ? 'danger' : 'warning',
          title: `Transferencia para ${transfer.to_name} sin aceptar`,
          detail:
            transfer.seconds_left <= 0
              ? 'El timbre venció: la llamada vuelve a la cola en el próximo barrido.'
              : `Vence en ${formatCallDuration(transfer.seconds_left)}.`,
        });
      }
    }

    for (const agent of agents) {
      if (agent.role === 'viewer') continue;
      if (isLongStatus({ status: agent.agent_status, seconds: agent.status_seconds })) {
        const inBreak = agent.agent_status === 'break';
        list.push({
          id: `status-${agent.user_id}`,
          tone: 'warning',
          title: `${agent.name} lleva ${formatCallDuration(agent.status_seconds)} en ${
            inBreak ? 'pausa' : 'cierre'
          }`,
          detail: inBreak
            ? `Motivo: ${pauseReasonLabel(agent.status_reason)}.`
            : 'El cierre bloquea nuevas llamadas para este agente.',
        });
      }
      if (agent.agent_status === 'available' && agent.presence === 'offline') {
        const lastSeenMs = agent.last_seen_at
          ? Date.parse(agent.last_seen_at)
          : NaN;
        const recentlyOnline =
          Number.isFinite(lastSeenMs) &&
          nowTick - lastSeenMs <= RECENT_OFFLINE_MS;
        if (recentlyOnline) {
          list.push({
            id: `ghost-${agent.user_id}`,
            tone: 'warning',
            title: `${agent.name} está Disponible pero desconectado`,
            detail:
              'Se desconectó hace menos de 15 minutos. No verá la cola hasta que vuelva a abrir el softphone.',
          });
        }
      }
    }

    return list;
  }, [agents, data, nowTick, queue, transfers]);

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
          Operación en vivo
        </h2>
        <div className="border-border text-muted-foreground rounded-xl border p-6 text-sm">
          Solo dueños y administradores pueden ver la operación en vivo del
          contact center.
        </div>
      </div>
    );
  }

  const availableCount = agents.filter(
    (agent) =>
      agent.role !== 'viewer' &&
      agent.presence !== 'offline' &&
      agent.agent_status === 'available'
  ).length;
  const onlineCount = agents.filter(
    (agent) => agent.role !== 'viewer' && agent.presence !== 'offline'
  ).length;
  const expiredCount = queue.filter((item) => item.sla === 'expired').length;
  const longestWait = longestWaitSeconds(queue.map((item) => item.wait_seconds));
  const maxWaitSeconds = data?.queueMaxWaitSeconds ?? 0;
  const updatedSeconds = data
    ? secondsSince(data.updated_at, nowTick)
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-lg font-semibold">
            Operación en vivo
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Cola, SLA y agentes en tiempo real. El panel se actualiza cada{' '}
            {REFRESH_MS / 1000} segundos y no interviene en las llamadas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={auto ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAuto((current) => !current)}
            aria-pressed={auto}
          >
            <CircleDot
              className={cn('mr-1.5 h-3.5 w-3.5', auto && 'animate-pulse')}
            />
            {auto ? 'En vivo' : 'Pausado'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Actualizar
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-300/60 bg-red-50 p-4 text-red-800 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      ) : null}

      {data?.migrationMissing ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">
            Aplica la migración 112_telephony.sql para registrar llamadas. Hasta
            entonces la cola y los agentes aparecerán sin actividad.
          </p>
        </div>
      ) : null}

      {data?.statusLogMissing ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">
            La bitácora de estados (migración 120) no está aplicada: no se puede
            medir cuánto lleva cada agente en su estado actual.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="En cola"
          value={String(queue.length)}
          icon={PhoneIncoming}
          subtitle={
            queue.length === 0
              ? 'Nadie esperando'
              : expiredCount > 0
                ? `${expiredCount} fuera de SLA`
                : 'Dentro del SLA'
          }
        />
        <MetricCard
          title="Espera más larga"
          value={queue.length === 0 ? '—' : formatCallDuration(longestWait)}
          icon={Clock}
          subtitle={
            maxWaitSeconds > 0
              ? `Máximo: ${formatCallDuration(maxWaitSeconds)}`
              : 'Sin límite de espera'
          }
        />
        <MetricCard
          title="Disponibles"
          value={String(availableCount)}
          icon={Headphones}
          subtitle={`${onlineCount} conectados`}
        />
        <MetricCard
          title="Transferencias"
          value={String(transfers.length)}
          icon={ArrowRightLeft}
          subtitle={
            transfers.length === 0
              ? 'Nadie esperando aceptación'
              : 'Esperando que las acepten'
          }
        />
      </div>

      <Panel
        title="Alertas"
        subtitle={
          alerts.length === 0
            ? 'Nada urgente en este momento.'
            : `${alerts.length} ${alerts.length === 1 ? 'aviso' : 'avisos'} para revisar.`
        }
        bodyClassName={alerts.length === 0 ? 'p-5' : 'p-0'}
      >
        {alerts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Sin llamadas por vencer, transferencias trabadas ni pausas largas.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex items-start gap-3 px-5 py-3">
                <span
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    alert.tone === 'danger' ? 'bg-red-500' : 'bg-amber-500'
                  )}
                />
                <div className="min-w-0">
                  <p className="text-foreground text-sm font-medium">
                    {alert.title}
                  </p>
                  <p className="text-muted-foreground text-xs">{alert.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Cola en vivo"
        subtitle={
          maxWaitSeconds > 0
            ? `SLA de ${formatCallDuration(maxWaitSeconds)} · ${Math.round(
                (data?.slaAtRiskRatio ?? 0.8) * 100
              )} % para avisar`
            : 'Sin límite de espera configurado'
        }
        bodyClassName="p-0"
      >
        {queue.length === 0 ? (
          <p className="text-muted-foreground p-5 text-sm">
            No hay llamadas esperando. Buena señal.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Espera</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Habilidades</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <p className="text-foreground text-sm font-medium">
                      {callLabel(item)}
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      {item.from_number
                        ? formatPhoneDisplay(item.from_number)
                        : 'Sin número'}
                      {item.to_number
                        ? ` → ${formatPhoneDisplay(item.to_number)}`
                        : ''}
                    </p>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatCallDuration(item.wait_seconds)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn('font-medium', SLA_BADGE[item.sla])}
                    >
                      {queueSlaLabel(item.sla)}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {item.priority}
                  </TableCell>
                  <TableCell>
                    {item.required_skills.length === 0 ? (
                      <span className="text-muted-foreground text-xs">
                        Cualquiera
                      </span>
                    ) : (
                      <span className="text-xs">
                        {item.required_skills.join(', ')}
                        {item.overflowed_at ? ' · desbordada' : ''}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Transferencias sin aceptar"
          subtitle="La sala sigue viva: el cliente espera a que alguien conteste."
          bodyClassName={transfers.length === 0 ? 'p-5' : 'p-0'}
        >
          {transfers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Ninguna transferencia esperando respuesta.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {transfers.map((transfer) => (
                <li
                  key={transfer.call_id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-sm font-medium">
                      {callLabel(transfer)}
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      {transfer.from_name ?? 'Agente'} → {transfer.to_name}
                      {transfer.transfer_count > 1
                        ? ` · intento ${transfer.transfer_count}`
                        : ''}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'font-medium',
                      transfer.seconds_left != null &&
                        transfer.seconds_left <= 5
                        ? SLA_BADGE.expired
                        : SLA_BADGE.none
                    )}
                  >
                    {transfer.seconds_left == null
                      ? 'Timbre activo'
                      : transfer.seconds_left <= 0
                        ? 'Vencida'
                        : `Vence en ${formatCallDuration(
                            transfer.seconds_left
                          )}`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Agentes"
          subtitle="Estado operativo, tiempo en ese estado y llamada en curso."
        >
          <ul className="space-y-2.5">
            {agents.length === 0 ? (
              <li className="text-muted-foreground text-sm">
                El negocio no tiene miembros visibles.
              </li>
            ) : (
              agents.map((agent) => {
                const longStatus = isLongStatus({
                  status: agent.agent_status,
                  seconds: agent.status_seconds,
                });
                return (
                  <li
                    key={agent.user_id}
                    className={cn(
                      'border-border rounded-lg border p-3',
                      longStatus && 'border-amber-300/70 bg-amber-50/50 dark:bg-amber-950/10'
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <span
                          className={cn(
                            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                            STATUS_DOT[agent.agent_status]
                          )}
                        />
                        <div className="min-w-0">
                          <p className="text-foreground truncate text-sm font-medium">
                            {agent.name}
                          </p>
                          <p className="text-muted-foreground text-[11px]">
                            {ROLE_LABEL[agent.role] ?? agent.role} ·{' '}
                            {PRESENCE_LABEL[agent.presence] ?? agent.presence}
                            {agent.skills.length > 0
                              ? ` · ${agent.skills.join(', ')}`
                              : ''}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-foreground text-xs font-medium">
                          {agentStatusLabel(agent.agent_status)}
                          {agent.status_seconds != null
                            ? ` · ${formatCallDuration(agent.status_seconds)}`
                            : ''}
                        </p>
                        {agent.agent_status === 'break' && agent.status_reason ? (
                          <p className="text-muted-foreground text-[11px]">
                            {pauseReasonLabel(agent.status_reason)}
                          </p>
                        ) : null}
                        {agent.status_seconds == null ? (
                          <p className="text-muted-foreground text-[11px]">
                            Tiempo en estado desconocido
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {agent.active_call ? (
                      <p className="text-primary mt-2 flex items-center gap-1.5 text-[11px] font-medium">
                        <PhoneCall className="h-3 w-3" />
                        {agent.active_call.direction === 'inbound'
                          ? 'Entrante'
                          : 'Saliente'}
                        {' · '}
                        {displayNumber(agent.active_call.number) ??
                          'número oculto'}
                        {agent.call_seconds != null
                          ? ` · ${formatCallDuration(agent.call_seconds)}`
                          : ''}
                      </p>
                    ) : null}

                    {agent.transfer_pending ? (
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        <ArrowRightLeft className="h-3 w-3" />
                        Recibiendo una transferencia
                      </p>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
          <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-[11px]">
            <Users className="h-3 w-3" />
            {updatedSeconds != null
              ? `Actualizado hace ${formatCallDuration(updatedSeconds)}`
              : 'Sin datos todavía'}
          </p>
        </Panel>
      </div>
    </div>
  );
}
