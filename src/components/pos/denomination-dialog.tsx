"use client";

import { useMemo, useState } from "react";
import { Calculator, X } from "lucide-react";

import { PosButton } from "@/components/pos/pos-shell";
import { formatBs, formatUsd, round2, toNumber } from "@/lib/pos/money";

const USD = [100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.01];
const BS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25];

function key(value: number): string {
  return String(value);
}

export function DenominationDialog({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (payload: {
    usd: number;
    bs: number;
    usdBreakdown: Record<string, number>;
    bsBreakdown: Record<string, number>;
  }) => void;
}) {
  const [usd, setUsd] = useState<Record<string, string>>({});
  const [bs, setBs] = useState<Record<string, string>>({});

  const totals = useMemo(() => {
    const usdTotal = round2(
      USD.reduce(
        (sum, value) => sum + value * toNumber(usd[key(value)] ?? "0"),
        0,
      ),
    );
    const bsTotal = round2(
      BS.reduce(
        (sum, value) => sum + value * toNumber(bs[key(value)] ?? "0"),
        0,
      ),
    );
    return { usd: usdTotal, bs: bsTotal };
  }, [usd, bs]);

  function apply() {
    const usdBreakdown: Record<string, number> = {};
    const bsBreakdown: Record<string, number> = {};
    for (const value of USD) {
      const count = Math.trunc(toNumber(usd[key(value)] ?? "0"));
      if (count > 0) usdBreakdown[key(value)] = count;
    }
    for (const value of BS) {
      const count = Math.trunc(toNumber(bs[key(value)] ?? "0"));
      if (count > 0) bsBreakdown[key(value)] = count;
    }
    onApply({
      usd: totals.usd,
      bs: totals.bs,
      usdBreakdown,
      bsBreakdown,
    });
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
              <Calculator className="h-4 w-4 text-[#3f3fd8]" />
              Contar billetes y monedas
            </h2>
            <p className="text-xs text-slate-500">
              Anota cuántos hay de cada uno. El total se aplica al arqueo.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <section>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800">Dólares</p>
              <p className="text-sm font-black text-slate-900">
                {formatUsd(totals.usd)}
              </p>
            </div>
            <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {USD.map((value) => (
                <div
                  key={value}
                  className="flex items-center gap-2 px-3 py-1.5"
                >
                  <span className="w-20 text-xs font-semibold text-slate-600">
                    {formatUsd(value)}
                  </span>
                  <span className="text-[10px] text-slate-400">×</span>
                  <input
                    value={usd[key(value)] ?? ""}
                    onChange={(event) =>
                      setUsd((current) => ({
                        ...current,
                        [key(value)]: event.target.value,
                      }))
                    }
                    inputMode="numeric"
                    placeholder="0"
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-right text-xs outline-none focus:border-[#3f3fd8]"
                  />
                  <span className="ml-auto text-right text-[11px] text-slate-400">
                    {formatUsd(
                      round2(value * toNumber(usd[key(value)] ?? "0")),
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800">Bolívares</p>
              <p className="text-sm font-black text-slate-900">
                {formatBs(totals.bs)}
              </p>
            </div>
            <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {BS.map((value) => (
                <div
                  key={value}
                  className="flex items-center gap-2 px-3 py-1.5"
                >
                  <span className="w-20 text-xs font-semibold text-slate-600">
                    {formatBs(value)}
                  </span>
                  <span className="text-[10px] text-slate-400">×</span>
                  <input
                    value={bs[key(value)] ?? ""}
                    onChange={(event) =>
                      setBs((current) => ({
                        ...current,
                        [key(value)]: event.target.value,
                      }))
                    }
                    inputMode="numeric"
                    placeholder="0"
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-right text-xs outline-none focus:border-[#3f3fd8]"
                  />
                  <span className="ml-auto text-right text-[11px] text-slate-400">
                    {formatBs(
                      round2(value * toNumber(bs[key(value)] ?? "0")),
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              setUsd({});
              setBs({});
            }}
            className="text-[11px] font-semibold text-slate-500 hover:text-[#3f3fd8]"
          >
            Limpiar
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-[#3f3fd8] hover:bg-slate-50"
            >
              Cancelar
            </button>
            <PosButton onClick={apply}>Aplicar al arqueo</PosButton>
          </div>
        </div>
      </div>
    </div>
  );
}
