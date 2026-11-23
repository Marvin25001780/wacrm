import { describe, expect, it } from "vitest";

import {
  bestContactSlots,
  buildContactabilityGrid,
  contactabilityHours,
  contactabilityTotals,
  contactRate,
  slotLabel,
} from "./contactability";
import type { CollectionContactabilityRow } from "@/types/collections";

function row(
  weekday: number,
  hour_of_day: number,
  attempts: number,
  contacts: number,
): CollectionContactabilityRow {
  return {
    weekday,
    hour_of_day,
    attempts,
    contacts,
    debtors: attempts,
    agents: 1,
  };
}

describe("contactRate", () => {
  it("calcula el porcentaje y evita dividir por cero", () => {
    expect(contactRate(10, 40)).toBe(25);
    expect(contactRate(0, 0)).toBe(0);
    expect(contactRate(5, 0)).toBe(0);
    expect(contactRate(null, 10)).toBe(0);
    expect(contactRate(10, null)).toBe(0);
  });

  it("no se sale de 0–100", () => {
    expect(contactRate(20, 10)).toBe(100);
  });
});

describe("contactabilityHours", () => {
  it("usa 6–21 cuando no hay datos", () => {
    expect(contactabilityHours([])).toEqual([
      6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    ]);
  });

  it("se amplía si hay llamadas fuera de ese rango", () => {
    const hours = contactabilityHours([row(1, 5, 2, 1), row(1, 23, 1, 1)]);
    expect(hours[0]).toBe(5);
    expect(hours[hours.length - 1]).toBe(23);
  });
});

describe("buildContactabilityGrid", () => {
  it("arma 7 días con una celda por hora", () => {
    const grid = buildContactabilityGrid([row(2, 10, 20, 5)], [9, 10, 11]);

    expect(grid).toHaveLength(7);
    expect(grid[1].weekday).toBe(2);
    expect(grid[1].label).toBe("Martes");
    expect(grid[1].cells).toEqual([
      { attempts: 0, contacts: 0, rate: 0 },
      { attempts: 20, contacts: 5, rate: 25 },
      { attempts: 0, contacts: 0, rate: 0 },
    ]);
    expect(grid[0].cells[1].attempts).toBe(0);
  });
});

describe("contactabilityTotals", () => {
  it("suma intentos y contactos de todas las franjas", () => {
    expect(
      contactabilityTotals([row(1, 10, 20, 5), row(1, 11, 10, 4)]),
    ).toEqual({ attempts: 30, contacts: 9, rate: 30 });
  });
});

describe("bestContactSlots", () => {
  it("ordena por tasa y exige el mínimo de intentos", () => {
    const slots = bestContactSlots(
      [
        row(2, 10, 40, 16), // 40 %
        row(3, 11, 20, 9), // 45 %
        row(4, 12, 4, 4), // 100 % pero solo 4 intentos
        row(5, 13, 30, 12), // 40 %
      ],
      5,
      2,
    );

    expect(slots.map((slot) => slot.rate)).toEqual([45, 40]);
    expect(slots[0].weekday).toBe(3);
    expect(slots[1].hour).toBe(10);
  });

  it("devuelve vacío si nadie llega al mínimo", () => {
    expect(bestContactSlots([row(1, 10, 2, 2)], 5)).toEqual([]);
  });
});

describe("slotLabel", () => {
  it("describe la franja en hora local", () => {
    expect(slotLabel(2, 10)).toBe("Martes 10:00–11:00");
  });
});
