'use client';

// ============================================================
// Reportes de telefonía (WEM básico).
//
// Ventana de 7 / 30 / 90 días con los indicadores que usa un
// supervisor: volumen, contestadas, pérdidas, espera y duración
// medias, grabaciones y tiempo de cierre. Los agregados los calcula
// la API en hora de Caracas; aquí solo se dibujan.
//
// Las barras son CSS puro (sin librería de gráficos) para no sumar
// peso ni riesgos de SSR a una página que ya es pesada.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  Loader2,
  Phone,
  PhoneCall,
  PhoneMissed,
  RotateCcw,
  Target,
  Timer,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';

import { MetricCard } from '@/components/dashboard/metric-card';
import { Panel } from '@/components/metrics/panel';
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
import { cn } from '@/lib/utils';
import { formatCallDuration } from '@/lib/telephony/calls';
import { EXPORT_DATASETS, type ExportDataset } from '@/lib/telephony/export';
import { callDispositionLabel } from '@/types';
import type {
  TelephonyReport,
  TelephonyReportAgent,
  TelephonyReportCallbackAgent,
  TelephonyReportDay,
  TelephonyReportHour,
} from '@/lib/telephony/reports';

interface ReportResponse extends TelephonyReport {
  truncated?: boolean;
  rowLimit?: number;
  /** Falta aplicar la 122: no hay devoluciones que leer. */
  callbacksMissing?: boolean;
  /** Se superó el tope de filas: el reporte de devoluciones está acotado. */
  callbacksTruncated?: boolean;
}

const RANGES = [7, 30, 90] as const;

const roleText: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Admin',
  agent: 'Agente',
  viewer: 'Espectador',
};

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function seconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)} s`;
}

function dayLabel(key: string): string {
  const date = new Date(`${key}T12:00:00-04:00`);
  if (Number.isNaN(date.getTime())) return key;
  return format(date, 'd MMM', { locale: es });
}

export default function TelephonyReportsPage() {
  const { accountRole, loading: authLoading } = useAuth();
  const canView = accountRole === 'admin' || accountRole === 'owner';

  const [days, setDays] = useState<number>(7);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportDataset | null>(null);

  const load = useCallback(async (range: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/telephony/reports?days=${range}`, {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as
        | ReportResponse
        | { error?: string };
      if (!res.ok || !('totals' in body)) {
        setError(
          'error' in body && body.error
            ? body.error
            : 'No se pudieron cargar los reportes.'
        );
        setReport(null);
        return;
      }
      setReport(body);
    } catch {
      setError('Sin conexión: no se pudieron cargar los reportes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(days);
  }, [canView, days, load]);

  /**
   * Descarga el reporte en CSV. Se pide al servidor (no se rearma en el
   * navegador) para que el archivo incluya filas que la vista recorta y
   * para que el permiso se valide de nuevo en la API.
   */
  const exportCsv = async (dataset: ExportDataset) => {
    if (exporting) return;
    setExporting(dataset);
    try {
      const res = await fetch(
        `/api/telephony/reports/export?days=${days}&dataset=${dataset}`,
        { cache: 'no-store' }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(body.error ?? 'No se pudo exportar el reporte.');
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const fileName =
        /filename="([^"]+)"/.exec(disposition)?.[1] ??
        `reporte-${dataset}.csv`;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(objectUrl);

      if (res.headers.get('X-Export-Truncated') === 'true') {
        toast.warning(
          'El archivo incluye solo las 20 000 filas más recientes. Acorta el rango para exportarlo completo.'
        );
      } else {
        toast.success('Reporte exportado.');
      }
    } catch {
      toast.error('Sin conexión: no se pudo exportar el reporte.');
    } finally {
      setExporting(null);
    }
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
          Reportes de telefonía
        </h2>
        <div className="border-border text-muted-foreground rounded-xl border p-6 text-sm">
          Solo dueños y administradores pueden ver los reportes de la
          operación.
        </div>
      </div>
    );
  }

  const totals = report?.totals;
  const callbacks = report?.callbacks;
  const openCallbacks =
    (callbacks?.pending ?? 0) + (callbacks?.inProgress ?? 0);
  const callbackAgents = (callbacks?.agents ?? []).filter(
    (agent) => agent.claimed > 0 || agent.done > 0
  );
  const maxDay = Math.max(
    1,
    ...(report?.daysSeries.map((day) => day.total) ?? [])
  );
  const maxHour = Math.max(1, ...(report?.hours.map((h) => h.total) ?? []));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-lg font-semibold">
            Reportes de telefonía
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Volumen, nivel de servicio, tiempos y resultados de las
            llamadas. Las fechas y horas están en hora de Venezuela
            (America/Caracas).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border p-1">
            {RANGES.map((range) => (
              <Button
                key={range}
                variant={days === range ? 'default' : 'ghost'}
                size="sm"
                className={cn(
                  days === range && 'bg-primary text-primary-foreground'
                )}
                onClick={() => setDays(range)}
              >
                {range} días
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border p-1">
            <span className="text-muted-foreground px-1.5 text-[11px] font-medium">
              CSV
            </span>
            {EXPORT_DATASETS.map((dataset) => (
              <Button
                key={dataset.value}
                variant="ghost"
                size="sm"
                disabled={exporting !== null || loading}
                title="Descargar para Excel (separador ;)"
                onClick={() => void exportCsv(dataset.value)}
              >
                {exporting === dataset.value ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                )}
                {dataset.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-300/60 bg-red-50 p-4 text-red-800 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      ) : null}

      {report?.migrationMissing ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">
            Aplica la migración 112 para que el CRM empiece a guardar
            llamadas. Hasta entonces no hay nada que reportar.
          </p>
        </div>
      ) : null}

      {report?.truncated ? (
        <p className="text-muted-foreground text-xs">
          Se muestran las {report.rowLimit ?? 5000} llamadas más recientes de
          la ventana. Acorta el rango para un reporte completo.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Llamadas"
          value={loading ? '…' : String(totals?.total ?? 0)}
          icon={Phone}
          subtitle={`${totals?.inbound ?? 0} entrantes · ${totals?.outbound ?? 0} salientes`}
        />
        <MetricCard
          title="Contestadas"
          value={loading ? '…' : String(totals?.answered ?? 0)}
          icon={PhoneCall}
          subtitle={`Nivel de servicio ${percent(totals?.answerRate ?? null)}`}
        />
        <MetricCard
          title="Perdidas"
          value={loading ? '…' : String(totals?.missed ?? 0)}
          icon={PhoneMissed}
          subtitle={`Abandono ${percent(totals?.abandonmentRate ?? null)}`}
        />
        <MetricCard
          title="Espera media"
          value={loading ? '…' : seconds(totals?.avgWaitSeconds ?? null)}
          icon={Timer}
          subtitle="Antes de contestar una entrante"
        />
        <MetricCard
          title="Duración media"
          value={
            loading ? '…' : formatCallDuration(totals?.avgHandleSeconds ?? null)
          }
          icon={Clock}
          subtitle="Tiempo hablado por llamada"
        />
        <MetricCard
          title="Tiempo de cierre"
          value={loading ? '…' : seconds(totals?.avgWrapUpSeconds ?? null)}
          icon={TrendingUp}
          subtitle="De colgar a guardar la disposición"
        />
        <MetricCard
          title="Grabadas"
          value={loading ? '…' : String(totals?.recorded ?? 0)}
          icon={PhoneCall}
          subtitle={`${totals?.transcribed ?? 0} transcritas`}
        />
        <MetricCard
          title="Fallidas"
          value={loading ? '…' : String(totals?.failed ?? 0)}
          icon={AlertTriangle}
          subtitle={`${totals?.cancelled ?? 0} canceladas`}
        />
        <MetricCard
          title="Calidad (QA)"
          value={
            loading
              ? '…'
              : totals?.avgQaScore != null
                ? `${totals.avgQaScore}/100`
                : '—'
          }
          icon={ClipboardCheck}
          subtitle={`${totals?.qaCount ?? 0} humanas · IA ${totals?.aiQaCount ?? 0} · cobertura ${percent(totals?.qaCoverage ?? null)}`}
        />
        <MetricCard
          title="Devoluciones"
          value={loading ? '…' : String(callbacks?.total ?? 0)}
          icon={RotateCcw}
          subtitle={`${openCallbacks} abiertas · ${callbacks?.done ?? 0} atendidas`}
        />
        <MetricCard
          title="Respuesta media"
          value={
            loading
              ? '…'
              : formatCallDuration(callbacks?.avgResponseSeconds ?? null)
          }
          icon={Timer}
          subtitle={
            callbacks
              ? `Devolución · objetivo ${formatCallDuration(callbacks.slaTargetSeconds)}`
              : 'Tiempo hasta reclamar'
          }
        />
        <MetricCard
          title="Recuperación"
          value={loading ? '…' : percent(callbacks?.recoveryRate ?? null)}
          icon={Target}
          subtitle={`${callbacks?.done ?? 0} de ${callbacks?.total ?? 0} devueltas`}
        />
        <MetricCard
          title="SLA devoluciones"
          value={loading ? '…' : percent(callbacks?.slaCompliance ?? null)}
          icon={CheckCircle2}
          subtitle={`${callbacks?.slaMet ?? 0} de ${callbacks?.slaEligible ?? 0} a tiempo`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Llamadas por día"
          subtitle={report ? `${report.from} → ${report.to}` : undefined}
        >
          {loading ? (
            <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (
            <DayBars series={report?.daysSeries ?? []} max={maxDay} />
          )}
        </Panel>

        <Panel
          title="Llamadas por hora"
          subtitle="Hora local de Venezuela"
        >
          {loading ? (
            <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (
            <HourBars hours={report?.hours ?? []} max={maxHour} />
          )}
        </Panel>
      </div>

      <Panel
        title="Desempeño por agente"
        subtitle="Todo el equipo aparece, aunque no haya recibido llamadas."
        bodyClassName="p-0"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agente</TableHead>
              <TableHead className="text-right">Llamadas</TableHead>
              <TableHead className="text-right">Contestadas</TableHead>
              <TableHead className="text-right">Perdidas</TableHead>
              <TableHead className="text-right">Tiempo hablado</TableHead>
              <TableHead className="text-right">Duración media</TableHead>
              <TableHead className="text-right">QA</TableHead>
              <TableHead className="text-right">QA (IA)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(report?.agents ?? []).length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-muted-foreground py-6 text-center text-sm"
                >
                  Sin datos en la ventana seleccionada.
                </TableCell>
              </TableRow>
            ) : (
              (report?.agents ?? []).map((agent) => (
                <AgentRow key={agent.user_id} agent={agent} />
              ))
            )}
          </TableBody>
        </Table>
      </Panel>

      <Panel
        title="Resultados (disposiciones)"
        subtitle="Cómo terminaron las llamadas clasificadas."
      >
        {(report?.dispositions ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Todavía no hay llamadas clasificadas. El agente elige la
            disposición al colgar.
          </p>
        ) : (
          <ul className="space-y-2">
            {(report?.dispositions ?? []).map((item) => {
              const totalDispositions = (report?.dispositions ?? []).reduce(
                (sum, row) => sum + row.count,
                0
              );
              const width = totalDispositions
                ? Math.round((item.count / totalDispositions) * 100)
                : 0;
              return (
                <li key={item.disposition} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-foreground">
                      {callDispositionLabel(item.disposition)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {item.count} · {width}%
                    </span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="Devoluciones de llamadas perdidas"
        subtitle={
          callbacks
            ? `Solicitudes creadas en la ventana · SLA de primera respuesta ${formatCallDuration(callbacks.slaTargetSeconds)}`
            : 'Solicitudes creadas en la ventana.'
        }
      >
        {report?.callbacksMissing ? (
          <p className="text-muted-foreground text-sm">
            Falta aplicar la migración{' '}
            <code className="text-foreground">122_callback_requests.sql</code>{' '}
            para registrar devoluciones de llamadas perdidas.
          </p>
        ) : (callbacks?.total ?? 0) === 0 ? (
          <p className="text-muted-foreground text-sm">
            No se registraron devoluciones en la ventana. Cuando una
            entrante quede sin contestar, aparecerá aquí para que alguien
            la devuelva.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MiniStat
                label="Abiertas"
                value={String(openCallbacks)}
                hint={`${callbacks?.pending ?? 0} pendientes · ${callbacks?.inProgress ?? 0} en curso`}
              />
              <MiniStat
                label="Atendidas"
                value={String(callbacks?.done ?? 0)}
                hint={`Recuperación ${percent(callbacks?.recoveryRate ?? null)}`}
              />
              <MiniStat
                label="Canceladas"
                value={String(callbacks?.cancelled ?? 0)}
                hint="Cerradas sin devolver la llamada"
              />
              <MiniStat
                label="Manuales"
                value={String(callbacks?.manual ?? 0)}
                hint={`${callbacks?.fromMissed ?? 0} desde una llamada perdida`}
              />
              <MiniStat
                label="Respuesta media"
                value={formatCallDuration(callbacks?.avgResponseSeconds ?? null)}
                hint="Hasta que alguien la reclama"
              />
              <MiniStat
                label="Resolución media"
                value={formatCallDuration(
                  callbacks?.avgResolutionSeconds ?? null
                )}
                hint="Hasta cerrarla como atendida"
              />
              <MiniStat
                label="Abierta más antigua"
                value={formatCallDuration(callbacks?.oldestPendingSeconds ?? null)}
                hint="Antigüedad de la más vieja"
              />
              <MiniStat
                label="SLA de respuesta"
                value={percent(callbacks?.slaCompliance ?? null)}
                hint={`${callbacks?.slaMet ?? 0} de ${callbacks?.slaEligible ?? 0} reclamadas a tiempo`}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              La respuesta se mide desde el alta hasta el reclamo; el SLA
              solo evalúa las devoluciones que llegaron a reclamarse. Las
              que nunca se reclamaron cuentan para la recuperación, no
              para el SLA.
            </p>
            {report?.callbacksTruncated ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Se muestran las {report.rowLimit ?? 5000} devoluciones más
                recientes de la ventana. Acorta el rango para verlas todas.
              </p>
            ) : null}
          </div>
        )}
      </Panel>

      {callbackAgents.length > 0 ? (
        <Panel
          title="Devoluciones por agente"
          subtitle="Quién reclamó y quién cerró las devoluciones del periodo."
          bodyClassName="p-0"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agente</TableHead>
                <TableHead className="text-right">Reclamadas</TableHead>
                <TableHead className="text-right">Atendidas</TableHead>
                <TableHead className="text-right">Respuesta media</TableHead>
                <TableHead className="text-right">Resolución media</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {callbackAgents.map((agent) => (
                <CallbackAgentRow key={agent.user_id} agent={agent} />
              ))}
            </TableBody>
          </Table>
        </Panel>
      ) : null}
    </div>
  );
}

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border-border rounded-lg border p-3">
      <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
        {label}
      </p>
      <p className="text-foreground mt-0.5 text-lg font-semibold tabular-nums">
        {value}
      </p>
      {hint ? (
        <p className="text-muted-foreground text-[11px]">{hint}</p>
      ) : null}
    </div>
  );
}

function CallbackAgentRow({ agent }: { agent: TelephonyReportCallbackAgent }) {
  return (
    <TableRow>
      <TableCell>
        <p className="text-foreground text-sm">{agent.name}</p>
        <p className="text-muted-foreground text-[11px]">
          {roleText[agent.role] ?? agent.role}
        </p>
      </TableCell>
      <TableCell className="text-right tabular-nums">{agent.claimed}</TableCell>
      <TableCell className="text-right tabular-nums">{agent.done}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCallDuration(agent.avgResponseSeconds)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCallDuration(agent.avgResolutionSeconds)}
      </TableCell>
    </TableRow>
  );
}

function AgentRow({ agent }: { agent: TelephonyReportAgent }) {
  return (
    <TableRow>
      <TableCell>
        <p className="text-foreground text-sm">{agent.name}</p>
        <p className="text-muted-foreground text-[11px]">
          {roleText[agent.role] ?? agent.role}
        </p>
      </TableCell>
      <TableCell className="text-right tabular-nums">{agent.total}</TableCell>
      <TableCell className="text-right tabular-nums">{agent.answered}</TableCell>
      <TableCell className="text-right tabular-nums">{agent.missed}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCallDuration(agent.talkSeconds)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCallDuration(agent.avgHandleSeconds)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {agent.qaScore != null ? (
          <span
            className={cn(
              'font-medium',
              agent.qaScore >= 80
                ? 'text-emerald-600 dark:text-emerald-400'
                : agent.qaScore >= 60
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-red-600 dark:text-red-400'
            )}
            title={`${agent.qaCount ?? 0} evaluaciones humanas`}
          >
            {agent.qaScore}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {agent.aiQaScore != null ? (
          <span
            className={cn(
              'font-medium',
              agent.aiQaScore >= 80
                ? 'text-emerald-600 dark:text-emerald-400'
                : agent.aiQaScore >= 60
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-red-600 dark:text-red-400'
            )}
            title={`${agent.aiQaCount ?? 0} evaluaciones automáticas`}
          >
            {agent.aiQaScore}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function DayBars({ series, max }: { series: TelephonyReportDay[]; max: number }) {
  if (series.length === 0) {
    return <p className="text-muted-foreground text-sm">Sin datos.</p>;
  }
  return (
    <div
      className="flex h-40 items-end gap-1"
      role="img"
      aria-label="Llamadas por día"
    >
      {series.map((day) => {
        const height = Math.round((day.total / max) * 100);
        return (
          <div
            key={day.date}
            className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            title={`${dayLabel(day.date)}: ${day.total} llamadas · ${day.answered} contestadas · ${day.missed} perdidas`}
          >
            <div className="flex w-full flex-1 items-end">
              <div
                className="bg-primary/70 group-hover:bg-primary w-full rounded-t-sm transition-colors"
                style={{ height: `${Math.max(day.total ? 4 : 0, height)}%` }}
              />
            </div>
            <span className="text-muted-foreground w-full truncate text-center text-[9px]">
              {series.length > 14 ? day.date.slice(8) : dayLabel(day.date)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function HourBars({ hours, max }: { hours: TelephonyReportHour[]; max: number }) {
  return (
    <div
      className="flex h-40 items-end gap-0.5"
      role="img"
      aria-label="Llamadas por hora"
    >
      {hours.map((hour) => {
        const height = Math.round((hour.total / max) * 100);
        return (
          <div
            key={hour.hour}
            className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            title={`${String(hour.hour).padStart(2, '0')}:00 — ${hour.total} llamadas · ${hour.answered} contestadas`}
          >
            <div className="flex w-full flex-1 items-end">
              <div
                className={cn(
                  'w-full rounded-t-sm transition-colors',
                  hour.total ? 'bg-primary/70 group-hover:bg-primary' : 'bg-muted'
                )}
                style={{
                  height: `${Math.max(hour.total ? 4 : 0, height)}%`,
                }}
              />
            </div>
            {hour.hour % 3 === 0 ? (
              <span className="text-muted-foreground text-[9px]">
                {String(hour.hour).padStart(2, '0')}
              </span>
            ) : (
              <span className="text-[9px]">&nbsp;</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
