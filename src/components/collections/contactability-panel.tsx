"use client";

import { PhoneCall } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import {
  CONTACT_DAYS,
  CONTACT_WEEKDAYS,
  bestContactSlots,
  buildContactabilityGrid,
  contactabilityHours,
  contactabilityTotals,
  hourLabel,
  slotLabel,
} from "@/lib/collections/contactability";
import { formatPercent } from "@/lib/collections/format";
import { cn } from "@/lib/utils";
import type { CollectionContactabilityRow } from "@/types/collections";

/**
 * 130 — mapa de calor de llamadas por día y hora. Los números vienen de
 * `collection_contactability`; aquí solo se pinta la tasa y se destacan
 * las mejores franjas (con un mínimo de intentos para no recomendar una
 * hora por casualidad).
 */
export function ContactabilityPanel({
  rows,
}: {
  rows: CollectionContactabilityRow[];
}) {
  const totals = contactabilityTotals(rows);

  if (totals.attempts === 0) {
    return (
      <EmptyState
        icon={PhoneCall}
        title="Sin llamadas en los últimos 30 días"
        hint="Cuando los gestores registren gestiones con canal llamada, aquí aparecerá la mejor hora para contactar."
      />
    );
  }

  const hours = contactabilityHours(rows);
  const grid = buildContactabilityGrid(rows, hours);
  const best = bestContactSlots(rows);
  const maxRate = Math.max(
    1,
    ...grid.flatMap((day) => day.cells.map((cell) => cell.rate)),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>
          <strong className="text-sm text-foreground">{totals.attempts}</strong>{" "}
          llamadas
        </span>
        <span>
          <strong className="text-sm text-foreground">{totals.contacts}</strong>{" "}
          contactos
        </span>
        <span>
          <strong className="text-sm text-foreground">
            {formatPercent(totals.rate)}
          </strong>{" "}
          de contacto
        </span>
        <span>· últimos {CONTACT_DAYS} días</span>
      </div>

      {best.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Mejores franjas:</span>
          {best.map((slot) => (
            <span
              key={`${slot.weekday}-${slot.hour}`}
              className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-medium text-primary"
            >
              {slotLabel(slot.weekday, slot.hour)} · {formatPercent(slot.rate)}
              <span className="font-normal text-primary/70">
                ({slot.contacts}/{slot.attempts})
              </span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Aún no hay una franja con al menos 5 intentos; no se recomienda
          ninguna.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0.5 text-[11px]">
          <thead>
            <tr>
              <th className="w-12" />
              {CONTACT_WEEKDAYS.map((day) => (
                <th
                  key={day.value}
                  className="pb-1 text-center font-medium text-muted-foreground"
                >
                  {day.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour, hourIndex) => (
              <tr key={hour}>
                <th className="pr-2 text-right font-normal tabular-nums text-muted-foreground">
                  {hourLabel(hour)}
                </th>
                {grid.map((day) => {
                  const cell = day.cells[hourIndex];
                  const alpha =
                    cell.attempts === 0
                      ? 0
                      : 0.1 + (cell.rate / maxRate) * 0.7;

                  return (
                    <td
                      key={day.weekday}
                      title={`${day.label} ${hourLabel(hour)}: ${cell.contacts} contactos de ${cell.attempts} llamadas (${Math.round(cell.rate)}%)`}
                      className={cn(
                        "h-7 rounded text-center tabular-nums",
                        cell.attempts === 0 && "text-muted-foreground/30",
                      )}
                      style={
                        cell.attempts === 0
                          ? undefined
                          : {
                              backgroundColor: `rgba(67, 56, 216, ${alpha})`,
                              color: alpha > 0.45 ? "#fff" : undefined,
                            }
                      }
                    >
                      {cell.attempts === 0
                        ? "·"
                        : `${Math.round(cell.rate)}%`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Color más intenso = mayor tasa de contacto. Pasa el mouse por una
        celda para ver contactos e intentos. Horas en la zona del negocio
        (America/Caracas por defecto).
      </p>
    </div>
  );
}
