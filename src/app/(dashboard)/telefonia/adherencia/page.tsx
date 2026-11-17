'use client';

// ============================================================
// Adherencia (WEM) — migración 120.
//
// Compara el turno planificado del agente con lo que realmente
// registró la bitácora de estados y con el tiempo hablado. Los
// cálculos los hace la API (`/api/telephony/adherence`) en hora de
// Venezuela; aquí solo se muestra y se administran los turnos.
//
// Definiciones v1:
//   Programado = turnos del agente dentro de la ventana.
//   Conectado  = cualquier estado de agente registrado.
//   Disponible = tiempo en `available`.
//   Pausa      = tiempo en `break` (con motivo en la bitácora).
//   Hablado    = llamadas contestadas.
//   Adherencia = trabajo dentro del turno ÷ programado.
//   Ocupación  = hablado ÷ trabajo.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import { MetricCard } from '@/components/dashboard/metric-card';
import { Panel } from '@/components/metrics/panel';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { formatRatio } from '@/lib/telephony/adherence';
import { cn } from '@/lib/utils';
import type { AgentShift, TelephonyAdherenceRow } from '@/types';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Admin',
  agent: 'Agente',
  viewer: 'Espectador',
};

const WEEKDAYS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

/** Máximo de la API; la ventana se valida también en el cliente. */
const MAX_DAYS = 31;

interface AdherenceResponse {
  from: string;
  to: string;
  rows: TelephonyAdherenceRow[];
  migrationMissing: boolean;
  truncated: boolean;
  rowLimit?: number;
}

interface ShiftForm {
  weekday: number;
  startTime: string;
  endTime: string;
  label: string;
  /** Pausa programada opcional (migración 121). */
  breakStart: string;
  breakEnd: string;
  breakLabel: string;
}

const EMPTY_FORM: ShiftForm = {
  weekday: 1,
  startTime: '08:00',
  endTime: '17:00',
  label: '',
  breakStart: '',
  breakEnd: '',
  breakLabel: '',
};

/** Fecha local de Venezuela en formato `YYYY-MM-DD`. */
function caracasDate(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
}

function shiftTime(value: string): string {
  // `HH:MM:SS` → `HH:MM`
  return value.slice(0, 5);
}

/** Horas y minutos legibles para duraciones largas (`7 h 30 min`). */
function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours && minutes) return `${hours} h ${minutes} min`;
  if (hours) return `${hours} h`;
  return `${minutes} min`;
}

function ratioTone(value: number | null): string {
  if (value == null) return 'text-muted-foreground';
  if (value >= 0.9) return 'text-emerald-600 dark:text-emerald-400';
  if (value >= 0.75) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export default function AdherencePage() {
  const { accountRole, loading: authLoading } = useAuth();
  const canView = accountRole === 'admin' || accountRole === 'owner';

  const [from, setFrom] = useState(() =>
    caracasDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
  );
  const [to, setTo] = useState(() => caracasDate(new Date()));
  const [report, setReport] = useState<AdherenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [shiftAgent, setShiftAgent] = useState<TelephonyAdherenceRow | null>(
    null
  );
  const [form, setForm] = useState<ShiftForm>(EMPTY_FORM);
  const [savingShift, setSavingShift] = useState(false);
  const [deletingShiftId, setDeletingShiftId] = useState<string | null>(null);

  const load = useCallback(
    async (
      fromValue: string,
      toValue: string
    ): Promise<AdherenceResponse | null> => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          from: new Date(`${fromValue}T00:00:00-04:00`).toISOString(),
          to: new Date(`${toValue}T23:59:59-04:00`).toISOString(),
        });
        const res = await fetch(`/api/telephony/adherence?${params}`, {
          cache: 'no-store',
        });
        const body = (await res.json().catch(() => ({}))) as
          | AdherenceResponse
          | { error?: string };
        if (!res.ok || !('rows' in body)) {
          setError(
            'error' in body && body.error
              ? body.error
              : 'No se pudo cargar la adherencia.'
          );
          setReport(null);
          return null;
        }
        setReport(body);
        return body;
      } catch {
        setError('Sin conexión: no se pudo cargar la adherencia.');
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!canView) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(from, to);
    // Solo al entrar: los cambios de fecha se aplican con el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  const applyRange = () => {
    if (!from || !to) {
      toast.error('Elige la fecha inicial y la final.');
      return;
    }
    const start = new Date(`${from}T00:00:00-04:00`).getTime();
    const end = new Date(`${to}T23:59:59-04:00`).getTime();
    if (!(start < end)) {
      toast.error('La fecha inicial debe ser anterior a la final.');
      return;
    }
    if (end - start > MAX_DAYS * 24 * 60 * 60 * 1000) {
      toast.error(`La ventana máxima es de ${MAX_DAYS} días.`);
      return;
    }
    void load(from, to);
  };

  const summary = useMemo(() => {
    const rows = report?.rows ?? [];
    const scheduled = rows.reduce((sum, row) => sum + row.scheduledSeconds, 0);
    const logged = rows.reduce((sum, row) => sum + row.loggedSeconds, 0);
    const work = rows.reduce((sum, row) => sum + row.workSeconds, 0);
    const talk = rows.reduce((sum, row) => sum + row.talkSeconds, 0);
    const workInShift = rows.reduce(
      (sum, row) => sum + (row.adherence ?? 0) * row.scheduledSeconds,
      0
    );
    const breaks = rows.reduce((sum, row) => sum + row.breakCount, 0);
    const scheduledBreak = rows.reduce(
      (sum, row) => sum + row.scheduledBreakSeconds,
      0
    );
    const breakInside = rows.reduce(
      (sum, row) => sum + row.breakInsideSeconds,
      0
    );
    return {
      scheduled,
      logged,
      talk,
      breaks,
      scheduledBreak,
      breakInside,
      adherence: scheduled > 0 ? Math.min(1, workInShift / scheduled) : null,
      breakAdherence:
        scheduledBreak > 0 ? Math.min(1, breakInside / scheduledBreak) : null,
      occupancy: work > 0 ? Math.min(1, talk / work) : null,
    };
  }, [report]);

  const openShifts = (row: TelephonyAdherenceRow) => {
    setShiftAgent(row);
    setForm(EMPTY_FORM);
  };

  const refreshShiftAgent = async (userId: string) => {
    // Tras alta/baja se recarga todo: los totales de adherencia cambian.
    const data = await load(from, to);
    if (!data) return;
    setShiftAgent(data.rows.find((row) => row.user_id === userId) ?? null);
  };

  const addShift = async () => {
    if (!shiftAgent) return;
    const hasBreakStart = form.breakStart !== '';
    const hasBreakEnd = form.breakEnd !== '';
    if (hasBreakStart !== hasBreakEnd) {
      toast.error('La pausa necesita hora de entrada y de salida.');
      return;
    }
    if (hasBreakStart && form.breakStart === form.breakEnd) {
      toast.error('La pausa no puede empezar y terminar a la misma hora.');
      return;
    }
    setSavingShift(true);
    try {
      const res = await fetch('/api/telephony/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: shiftAgent.user_id,
          weekday: form.weekday,
          startTime: form.startTime,
          endTime: form.endTime,
          label: form.label.trim() || null,
          breakStart: hasBreakStart ? form.breakStart : null,
          breakEnd: hasBreakEnd ? form.breakEnd : null,
          breakLabel: hasBreakStart ? form.breakLabel.trim() || null : null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        shift?: AgentShift;
      };
      if (!res.ok || !body.shift) {
        toast.error(body.error ?? 'No se pudo crear el turno.');
        return;
      }
      setShiftAgent((current) =>
        current
          ? {
              ...current,
              shifts: [...current.shifts, body.shift as AgentShift].sort(
                (a, b) =>
                  a.weekday - b.weekday ||
                  a.start_time.localeCompare(b.start_time)
              ),
            }
          : current
      );
      setForm(EMPTY_FORM);
      toast.success('Turno añadido.');
      void refreshShiftAgent(shiftAgent.user_id);
    } finally {
      setSavingShift(false);
    }
  };

  const deleteShift = async (shift: AgentShift) => {
    setDeletingShiftId(shift.id);
    try {
      const res = await fetch(`/api/telephony/shifts/${shift.id}`, {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? 'No se pudo borrar el turno.');
        return;
      }
      setShiftAgent((current) =>
        current
          ? {
              ...current,
              shifts: current.shifts.filter((row) => row.id !== shift.id),
            }
          : current
      );
      toast.success('Turno eliminado.');
      void refreshShiftAgent(shift.user_id);
    } finally {
      setDeletingShiftId(null);
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
          Adherencia del equipo
        </h2>
        <div className="border-border text-muted-foreground rounded-xl border p-6 text-sm">
          Solo dueños y administradores pueden ver la adherencia y planificar
          turnos.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-lg font-semibold">
            Adherencia del equipo
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Turno planificado frente a lo que registró el agente. Las horas son
            de Venezuela (America/Caracas) y la ventana máxima es de{' '}
            {MAX_DAYS} días.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="adherence-from" className="text-[11px]">
              Desde
            </Label>
            <Input
              id="adherence-from"
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              className="h-9 w-[9.5rem]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="adherence-to" className="text-[11px]">
              Hasta
            </Label>
            <Input
              id="adherence-to"
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
              className="h-9 w-[9.5rem]"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={applyRange}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
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

      {report?.migrationMissing ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">
            Aplica la migración 120_wem_adherence.sql para guardar turnos y
            bitácora de estados. Hasta entonces la adherencia aparecerá vacía.
          </p>
        </div>
      ) : null}

      {report?.truncated ? (
        <p className="text-muted-foreground text-xs">
          Se leyeron las {report.rowLimit ?? 20000} filas más recientes. Acorta
          la ventana para un cálculo completo.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="Programado"
          value={loading ? '…' : duration(summary.scheduled)}
          icon={CalendarClock}
          subtitle={`${report?.rows.filter((row) => row.scheduledSeconds > 0).length ?? 0} agentes con turno`}
        />
        <MetricCard
          title="Conectado"
          value={loading ? '…' : duration(summary.logged)}
          icon={CalendarCheck}
          subtitle={`${report?.rows.length ?? 0} agentes en la ventana`}
        />
        <MetricCard
          title="Adherencia"
          value={loading ? '…' : formatRatio(summary.adherence)}
          icon={CalendarCheck}
          subtitle="Trabajo dentro del turno ÷ programado"
        />
        <MetricCard
          title="Ocupación"
          value={loading ? '…' : formatRatio(summary.occupancy)}
          icon={CalendarCheck}
          subtitle={`${duration(summary.talk)} hablados · ${summary.breaks} pausas`}
        />
        <MetricCard
          title="Pausas a tiempo"
          value={loading ? '…' : formatRatio(summary.breakAdherence)}
          icon={CalendarClock}
          subtitle={`${duration(summary.scheduledBreak)} programadas · ${duration(summary.breakInside)} dentro`}
        />
      </div>

      <Panel
        title="Por agente"
        subtitle="Toca Turnos para planificar la semana del agente."
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agente</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead className="text-right">Programado</TableHead>
                <TableHead className="text-right">Conectado</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
                <TableHead className="text-right">Pausa</TableHead>
                <TableHead className="text-right">Pausa prog.</TableHead>
                <TableHead className="text-right">Cumple pausa</TableHead>
                <TableHead className="text-right">Hablado</TableHead>
                <TableHead className="text-right">Adherencia</TableHead>
                <TableHead className="text-right">Ocupación</TableHead>
                <TableHead className="text-right">Turnos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !report ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="text-muted-foreground py-8 text-center text-sm"
                  >
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Calculando…
                  </TableCell>
                </TableRow>
              ) : (report?.rows.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="text-muted-foreground py-8 text-center text-sm"
                  >
                    No hay agentes en este negocio.
                  </TableCell>
                </TableRow>
              ) : (
                report?.rows.map((row) => (
                  <TableRow key={row.user_id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {ROLE_LABEL[row.role] ?? row.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {duration(row.scheduledSeconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {duration(row.loggedSeconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {duration(row.availableSeconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.breakCount > 0
                        ? `${duration(row.breakSeconds)} (${row.breakCount})`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {duration(row.scheduledBreakSeconds)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-semibold tabular-nums',
                        ratioTone(row.breakAdherence)
                      )}
                    >
                      {formatRatio(row.breakAdherence)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {duration(row.talkSeconds)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-semibold tabular-nums',
                        ratioTone(row.adherence)
                      )}
                    >
                      {formatRatio(row.adherence)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-semibold tabular-nums',
                        ratioTone(row.occupancy)
                      )}
                    >
                      {formatRatio(row.occupancy)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openShifts(row)}
                      >
                        {row.shifts.length}
                        <CalendarClock className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Dialog
        open={Boolean(shiftAgent)}
        onOpenChange={(open) => {
          if (!open) setShiftAgent(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Turnos de {shiftAgent?.name ?? 'agente'}</DialogTitle>
            <DialogDescription>
              Se repiten cada semana en hora de Venezuela. Un turno que termina
              antes de empezar cruza medianoche (por ejemplo, 22:00 a 06:00).
              La pausa es opcional; si la programas, se compara con la pausa
              real que registra el agente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              {shiftAgent?.shifts.length ? (
                shiftAgent.shifts.map((shift) => (
                  <div
                    key={shift.id}
                    className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground text-sm font-medium">
                        {WEEKDAYS[shift.weekday] ?? shift.weekday} ·{' '}
                        {shiftTime(shift.start_time)}–{shiftTime(shift.end_time)}
                      </p>
                      {shift.label ? (
                        <p className="text-muted-foreground truncate text-[11px]">
                          {shift.label}
                        </p>
                      ) : null}
                      {shift.break_start && shift.break_end ? (
                        <p className="text-muted-foreground truncate text-[11px]">
                          Pausa {shiftTime(shift.break_start)}–
                          {shiftTime(shift.break_end)}
                          {shift.break_label ? ` · ${shift.break_label}` : ''}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Borrar turno"
                      disabled={deletingShiftId === shift.id}
                      onClick={() => void deleteShift(shift)}
                    >
                      {deletingShiftId === shift.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-sm">
                  Sin turnos: la adherencia quedará vacía y solo se medirá la
                  ocupación.
                </p>
              )}
            </div>

            <div className="border-border space-y-3 rounded-lg border p-3">
              <p className="text-foreground text-sm font-medium">
                Añadir turno
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="shift-weekday" className="text-[11px]">
                    Día
                  </Label>
                  <select
                    id="shift-weekday"
                    value={form.weekday}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        weekday: Number(event.target.value),
                      }))
                    }
                    className="border-border bg-background text-foreground h-9 w-full rounded-md border px-2 text-sm"
                  >
                    {WEEKDAYS.map((label, index) => (
                      <option key={label} value={index}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="shift-label" className="text-[11px]">
                    Etiqueta (opcional)
                  </Label>
                  <Input
                    id="shift-label"
                    value={form.label}
                    maxLength={60}
                    placeholder="Turno mañana"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        label: event.target.value,
                      }))
                    }
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="shift-start" className="text-[11px]">
                    Entrada
                  </Label>
                  <Input
                    id="shift-start"
                    type="time"
                    value={form.startTime}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        startTime: event.target.value,
                      }))
                    }
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="shift-end" className="text-[11px]">
                    Salida
                  </Label>
                  <Input
                    id="shift-end"
                    type="time"
                    value={form.endTime}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        endTime: event.target.value,
                      }))
                    }
                    className="h-9"
                  />
                </div>
              </div>
              <div className="border-border/60 border-t pt-2">
                <p className="text-muted-foreground mb-1.5 text-[11px] font-medium">
                  Pausa programada (opcional)
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="break-start" className="text-[11px]">
                      Entrada
                    </Label>
                    <Input
                      id="break-start"
                      type="time"
                      value={form.breakStart}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          breakStart: event.target.value,
                        }))
                      }
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="break-end" className="text-[11px]">
                      Salida
                    </Label>
                    <Input
                      id="break-end"
                      type="time"
                      value={form.breakEnd}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          breakEnd: event.target.value,
                        }))
                      }
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="break-label" className="text-[11px]">
                      Etiqueta
                    </Label>
                    <Input
                      id="break-label"
                      value={form.breakLabel}
                      maxLength={60}
                      placeholder="Almuerzo"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          breakLabel: event.target.value,
                        }))
                      }
                      className="h-9"
                    />
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => void addShift()}
                disabled={
                  savingShift ||
                  !form.startTime ||
                  !form.endTime ||
                  form.startTime === form.endTime ||
                  (form.breakStart !== '') !== (form.breakEnd !== '') ||
                  (form.breakStart !== '' && form.breakStart === form.breakEnd)
                }
              >
                {savingShift ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="mr-1 h-3.5 w-3.5" />
                )}
                Añadir turno
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftAgent(null)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
