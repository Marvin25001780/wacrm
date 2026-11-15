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
  ClipboardCheck,
  Clock,
  Loader2,
  Phone,
  PhoneCall,
  PhoneMissed,
  Timer,
  TrendingUp,
} from 'lucide-react';

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
import { callDispositionLabel } from '@/types';
import type {
  TelephonyReport,
  TelephonyReportAgent,
  TelephonyReportDay,
  TelephonyReportHour,
} from '@/lib/telephony/reports';

interface ReportResponse extends TelephonyReport {
  truncated?: boolean;
  rowLimit?: number;
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
          subtitle={`${totals?.qaCount ?? 0} evaluadas · cobertura ${percent(totals?.qaCoverage ?? null)}`}
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {(report?.agents ?? []).length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
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
    </div>
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
            title={`${agent.qaCount ?? 0} evaluaciones`}
          >
            {agent.qaScore}
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
