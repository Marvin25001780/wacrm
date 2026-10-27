"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export interface UnitOption {
  value: string;
  label: string;
  short: string;
}

export const UNITS: UnitOption[] = [
  { value: "bulto", label: "Bulto (bulto)", short: "bulto" },
  { value: "caja", label: "Caja (caja)", short: "caja" },
  { value: "cm", label: "Centímetro (cm)", short: "cm" },
  { value: "docena", label: "Docena (docena)", short: "docena" },
  { value: "g", label: "Gramo (g)", short: "g" },
  { value: "kg", label: "Kilogramo (kg)", short: "kg" },
  { value: "l", label: "Litro (l)", short: "l" },
  { value: "m", label: "Metro (m)", short: "m" },
  { value: "m2", label: "Metro cuadrado (m2)", short: "m2" },
  { value: "m3", label: "Metro cúbico (m3)", short: "m3" },
  { value: "ml", label: "Mililitro (ml)", short: "ml" },
  { value: "oz", label: "Onza (oz)", short: "oz" },
  { value: "lb", label: "Libra (lb)", short: "lb" },
  { value: "paquete", label: "Paquete (paquete)", short: "paquete" },
  { value: "botella", label: "Botella (botella)", short: "botella" },
  { value: "lata", label: "Lata (lata)", short: "lata" },
  { value: "servicio", label: "Servicio (servicio)", short: "servicio" },
  { value: "unidad", label: "Unidad (und)", short: "und" },
];

export function unitLabel(value: string): string {
  return UNITS.find((unit) => unit.value === value)?.label ?? value;
}

export function unitShort(value: string): string {
  return UNITS.find((unit) => unit.value === value)?.short ?? value;
}

export function UnitSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const options = useMemo(() => {
    const list = UNITS.some((unit) => unit.value === value)
      ? UNITS
      : [...UNITS, { value, label: value, short: value }];
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (unit) =>
        unit.label.toLowerCase().includes(term) ||
        unit.value.toLowerCase().includes(term),
    );
  }, [value, search]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setSearch("");
        }}
        className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm outline-none hover:border-slate-300 focus:border-[#4338ca]"
      >
        <span className={value ? "text-slate-700" : "text-slate-400"}>
          {value ? unitLabel(value) : "Unidad (und)"}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {options.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">
                Sin resultados
              </p>
            ) : (
              options.map((unit) => (
                <button
                  key={unit.value}
                  type="button"
                  onClick={() => {
                    onChange(unit.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                    value === unit.value
                      ? "bg-indigo-50 font-semibold text-[#4338ca]"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {unit.label}
                  {value === unit.value ? (
                    <Check className="h-4 w-4 text-[#4338ca]" />
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
