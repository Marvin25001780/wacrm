import { describe, expect, it } from "vitest";

import {
  availablePromiseResolutions,
  isPromiseOpen,
  isPromiseStatus,
  overduePromiseCount,
  resolutionMessage,
} from "./promise-actions";

describe("isPromiseOpen", () => {
  it("solo pending y partial están abiertas", () => {
    expect(isPromiseOpen("pending")).toBe(true);
    expect(isPromiseOpen("partial")).toBe(true);
    expect(isPromiseOpen("kept")).toBe(false);
    expect(isPromiseOpen("broken")).toBe(false);
    expect(isPromiseOpen("cancelled")).toBe(false);
    expect(isPromiseOpen(null)).toBe(false);
    expect(isPromiseOpen(undefined)).toBe(false);
  });
});

describe("availablePromiseResolutions", () => {
  it("ofrece cierre en una PTP abierta, sin reabrir", () => {
    const options = availablePromiseResolutions("pending", true);
    expect(options.map((option) => option.value)).toEqual([
      "kept",
      "broken",
      "cancelled",
    ]);
  });

  it("un agente no puede reabrir una PTP cerrada", () => {
    expect(availablePromiseResolutions("kept", false)).toEqual([]);
    expect(availablePromiseResolutions("broken", false)).toEqual([]);
  });

  it("un admin puede reabrir una PTP cerrada", () => {
    expect(availablePromiseResolutions("kept", true).map((o) => o.value)).toEqual([
      "pending",
    ]);
    expect(availablePromiseResolutions("broken", true).map((o) => o.value)).toEqual([
      "pending",
    ]);
  });

  it("no ofrece nada para un estado desconocido", () => {
    expect(availablePromiseResolutions("otro", true)).toEqual([]);
  });
});

describe("resolutionMessage", () => {
  it("nombra al deudor cuando se conoce", () => {
    expect(resolutionMessage("kept", "Ana Pérez")).toBe(
      "PTP de Ana Pérez marcada como cumplida",
    );
    expect(resolutionMessage("broken")).toBe("PTP marcada como rota");
    expect(resolutionMessage("pending", "Luis")).toBe("PTP de Luis reabierta");
  });
});

describe("overduePromiseCount", () => {
  it("cuenta solo abiertas con días negativos", () => {
    expect(
      overduePromiseCount([
        { status: "pending", days_left: -3 },
        { status: "pending", days_left: 0 },
        { status: "partial", days_left: -1 },
        { status: "broken", days_left: -5 },
        { status: "kept", days_left: -3 },
      ]),
    ).toBe(2);
  });
});

describe("isPromiseStatus", () => {
  it("reconoce los estados del enum", () => {
    expect(isPromiseStatus("partial")).toBe(true);
    expect(isPromiseStatus("otro")).toBe(false);
  });
});
