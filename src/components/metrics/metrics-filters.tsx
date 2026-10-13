"use client";

// ============================================================
// Barra de filtros compartida del módulo de Métricas.
//
// Aparece en la parte superior de todas las secciones: rango de
// tiempo (con rango personalizado), agente, equipo, canal y tipo,
// más los botones "Aplicar" y "Restablecer".
// ============================================================

import { CalendarRange, Check, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CHANNEL_CATALOG, channelMeta } from "@/lib/metrics/channels";
import {
  PERIOD_OPTIONS,
  formatRangeLabel,
  type PeriodPreset,
} from "@/lib/metrics/period";
import { useMetricsFilters } from "@/components/metrics/metrics-filter-context";

export function MetricsFilters() {
  const { draft, setDraft, apply, reset, isDirty, range, agents, teams } =
    useMetricsFilters();

  const periodLabel =
    PERIOD_OPTIONS.find((o) => o.key === draft.preset)?.label ?? "Personalizado";
  const agentLabel =
    draft.agentId === "all"
      ? "Todos los agentes"
      : agents.find((a) => a.id === draft.agentId)?.name ?? "Todos los agentes";
  const teamLabel =
    draft.teamId === "all"
      ? "Todos los equipos"
      : teams.find((t) => t.id === draft.teamId)?.name ?? "Todos los equipos";
  const channelLabel =
    draft.channel === "all"
      ? "Todos los canales"
      : channelMeta(draft.channel).label;
  const typeLabel =
    draft.type === "incoming"
      ? "Entrantes"
      : draft.type === "outgoing"
      ? "Salientes"
      : "Todos";

  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-3">
        {/* Rango de tiempo */}
        <div className="flex min-w-[150px] flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Tiempo
          </span>
          <Select
            value={draft.preset}
            onValueChange={(val) =>
              setDraft({ preset: (val ?? "7") as PeriodPreset })
            }
          >
            <SelectTrigger className="w-full border-border bg-muted text-foreground">
              <SelectValue>{periodLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="border-border bg-popover">
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {draft.preset === "custom" && (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Desde
              </span>
              <Input
                type="date"
                value={draft.customStart}
                onChange={(e) => setDraft({ customStart: e.target.value })}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Hasta
              </span>
              <Input
                type="date"
                value={draft.customEnd}
                onChange={(e) => setDraft({ customEnd: e.target.value })}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </>
        )}

        {/* Agente */}
        <div className="flex min-w-[150px] flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Filtrar agente
          </span>
          <Select
            value={draft.agentId}
            onValueChange={(val) => setDraft({ agentId: val ?? "all" })}
          >
            <SelectTrigger className="w-full border-border bg-muted text-foreground">
              <SelectValue>{agentLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="border-border bg-popover">
              <SelectItem value="all">Todos los agentes</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Equipo */}
        <div className="flex min-w-[150px] flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Equipo
          </span>
          <Select
            value={draft.teamId}
            onValueChange={(val) => setDraft({ teamId: val ?? "all" })}
          >
            <SelectTrigger className="w-full border-border bg-muted text-foreground">
              <SelectValue>{teamLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="border-border bg-popover">
              <SelectItem value="all">Todos los equipos</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Canal */}
        <div className="flex min-w-[140px] flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Canal
          </span>
          <Select
            value={draft.channel}
            onValueChange={(val) => setDraft({ channel: val ?? "all" })}
          >
            <SelectTrigger className="w-full border-border bg-muted text-foreground">
              <SelectValue>{channelLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="border-border bg-popover">
              <SelectItem value="all">Todos los canales</SelectItem>
              {CHANNEL_CATALOG.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tipo */}
        <div className="flex min-w-[140px] flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Tipo
          </span>
          <Select
            value={draft.type}
            onValueChange={(val) => setDraft({ type: val ?? "all" })}
          >
            <SelectTrigger className="w-full border-border bg-muted text-foreground">
              <SelectValue>{typeLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="border-border bg-popover">
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="incoming">Entrantes</SelectItem>
              <SelectItem value="outgoing">Salientes</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Acciones */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            onClick={reset}
            className="border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Restablecer
          </Button>
          <Button onClick={apply} disabled={!isDirty}>
            <Check className="mr-1.5 h-3.5 w-3.5" />
            Aplicar
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <CalendarRange className="h-3.5 w-3.5" />
        <span>{formatRangeLabel(range)}</span>
        {!isDirty ? (
          <span className="inline-flex items-center gap-1">
            <SlidersHorizontal className="h-3 w-3" />
            Filtros aplicados
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-amber-400">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Hay cambios sin aplicar
          </span>
        )}
      </div>
    </div>
  );
}
