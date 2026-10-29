import { formatBs, formatUsd, usdToBs } from "@/lib/pos/money";
import {
  WEEKDAY_LABELS,
  type BreakdownRow,
  type ProductRow,
} from "@/lib/pos/sales-report";

const VISIBLE_ROWS = 8;

export function BreakdownCard({
  title,
  subtitle,
  rows,
  rate,
  countLabel,
}: {
  title: string;
  subtitle?: string;
  rows: BreakdownRow[];
  rate: number;
  countLabel: string;
}) {
  const sum = rows.reduce((acc, row) => acc + row.total, 0);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-bold text-slate-800">{title}</p>
      {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      {rows.length === 0 ? (
        <p className="mt-4 text-xs text-slate-500">Sin datos en el período.</p>
      ) : (
        <>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="pb-2 font-semibold">Nombre</th>
                <th className="pb-2 text-right font-semibold">{countLabel}</th>
                <th className="pb-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, VISIBLE_ROWS).map((row) => {
                const share = sum > 0 ? (row.total / sum) * 100 : 0;
                return (
                  <tr key={row.label}>
                    <td className="py-2 text-slate-700">{row.label}</td>
                    <td className="py-2 text-right text-slate-500">
                      {Math.round(row.count)}
                    </td>
                    <td className="py-2 text-right">
                      <span className="block font-semibold text-slate-900">
                        {formatUsd(row.total)}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        {formatBs(usdToBs(row.total, rate))} · {share.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > VISIBLE_ROWS ? (
            <p className="mt-2 text-[11px] text-slate-400">
              y {rows.length - VISIBLE_ROWS} más
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function ProductsCard({
  title,
  subtitle,
  rows,
  rate,
}: {
  title: string;
  subtitle?: string;
  rows: ProductRow[];
  rate: number;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-bold text-slate-800">{title}</p>
      {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      {rows.length === 0 ? (
        <p className="mt-4 text-xs text-slate-500">Sin ventas en el período.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2 font-semibold">Producto</th>
              <th className="pb-2 text-right font-semibold">Cant.</th>
              <th className="pb-2 text-right font-semibold">Total</th>
              <th className="pb-2 text-right font-semibold">Margen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const marginPct = row.total > 0 ? (row.margin / row.total) * 100 : 0;
              return (
                <tr key={row.label}>
                  <td className="py-2 text-slate-700">{row.label}</td>
                  <td className="py-2 text-right text-slate-500">
                    {Math.round(row.quantity)}
                  </td>
                  <td className="py-2 text-right">
                    <span className="block font-semibold text-slate-900">
                      {formatUsd(row.total)}
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      {formatBs(usdToBs(row.total, rate))}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <span className="block font-semibold text-slate-900">
                      {formatUsd(row.margin)}
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      {marginPct.toFixed(0)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function HeatmapCard({
  title,
  subtitle,
  heat,
  max,
}: {
  title: string;
  subtitle?: string;
  heat: number[][];
  max: number;
}) {
  const hasData = heat.some((day) => day.some((value) => value > 0));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-bold text-slate-800">{title}</p>
      {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      {!hasData ? (
        <p className="mt-4 text-xs text-slate-500">Sin ventas en el período.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <div
            className="grid min-w-[760px] gap-[3px] text-[10px] text-slate-500"
            style={{ gridTemplateColumns: "3.5rem repeat(24, minmax(0, 1fr))" }}
          >
            <div />
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={`h-${hour}`} className="text-center">
                {hour % 3 === 0 ? `${String(hour).padStart(2, "0")}h` : ""}
              </div>
            ))}
            {heat.map((day, dayIndex) => (
              <div key={`d-${dayIndex}`} className="contents">
                <div className="flex items-center font-semibold text-slate-600">
                  {WEEKDAY_LABELS[dayIndex]}
                </div>
                {day.map((value, hour) => (
                  <div
                    key={`c-${dayIndex}-${hour}`}
                    title={`${WEEKDAY_LABELS[dayIndex]} ${String(hour).padStart(2, "0")}:00 · ${value} venta(s)`}
                    className="flex h-7 items-center justify-center rounded"
                    style={{
                      backgroundColor:
                        value > 0
                          ? `rgba(63, 63, 216, ${0.15 + (0.85 * value) / max})`
                          : "#f8fafc",
                      color: value / max > 0.5 ? "#ffffff" : "#334155",
                    }}
                  >
                    {value > 0 ? value : ""}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
