import { describe, expect, it } from "vitest";

import {
  DEFAULT_RESPONSE_SLA_MINUTES,
  formatWaiting,
  minutesSince,
  normalizeSlaMinutes,
  slaLevel,
  waitingLabel,
} from "./response";

describe("normalizeSlaMinutes", () => {
  it("usa 30 por defecto si no hay valor", () => {
    expect(normalizeSlaMinutes(undefined)).toBe(DEFAULT_RESPONSE_SLA_MINUTES);
    expect(normalizeSlaMinutes(null)).toBe(DEFAULT_RESPONSE_SLA_MINUTES);
    expect(normalizeSlaMinutes("no es un número")).toBe(
      DEFAULT_RESPONSE_SLA_MINUTES,
    );
  });

  it("redondea y limita a 1–1440", () => {
    expect(normalizeSlaMinutes(15.4)).toBe(15);
    expect(normalizeSlaMinutes(0)).toBe(1);
    expect(normalizeSlaMinutes(-20)).toBe(1);
    expect(normalizeSlaMinutes(5000)).toBe(1440);
    expect(normalizeSlaMinutes("60")).toBe(60);
  });
});

describe("formatWaiting", () => {
  it("trata la ausencia de espera como guion", () => {
    expect(formatWaiting(null)).toBe("—");
    expect(formatWaiting(undefined)).toBe("—");
    expect(formatWaiting(-3)).toBe("—");
    expect(formatWaiting(Number.NaN)).toBe("—");
  });

  it("formatea minutos, horas y días", () => {
    expect(formatWaiting(0)).toBe("menos de 1 min");
    expect(formatWaiting(4)).toBe("4 min");
    expect(formatWaiting(59)).toBe("59 min");
    expect(formatWaiting(60)).toBe("1 h");
    expect(formatWaiting(125)).toBe("2 h 5 min");
    expect(formatWaiting(1440)).toBe("1 d");
    expect(formatWaiting(1500)).toBe("1 d 1 h");
    expect(formatWaiting(3000)).toBe("2 d 2 h");
  });

  it("antepone “hace” salvo cuando no hay espera", () => {
    expect(waitingLabel(12)).toBe("hace 12 min");
    expect(waitingLabel(null)).toBe("—");
  });
});

describe("slaLevel", () => {
  it("no clasifica una espera inexistente", () => {
    expect(slaLevel(null)).toBeNull();
    expect(slaLevel(undefined)).toBeNull();
    expect(slaLevel(-1)).toBeNull();
  });

  it("clasifica contra el SLA configurado", () => {
    expect(slaLevel(5, 30)).toBe("ok");
    expect(slaLevel(14, 30)).toBe("ok");
    expect(slaLevel(15, 30)).toBe("warn");
    expect(slaLevel(29, 30)).toBe("warn");
    expect(slaLevel(30, 30)).toBe("late");
    expect(slaLevel(180, 30)).toBe("late");
  });

  it("usa 30 minutos si el SLA llega inválido", () => {
    expect(slaLevel(10, null)).toBe("ok");
    expect(slaLevel(20, 0)).toBe("late");
  });
});

describe("minutesSince", () => {
  it("mide con la lectura del servidor", () => {
    expect(
      minutesSince("2026-11-21T10:00:00.000Z", "2026-11-21T10:12:30.000Z"),
    ).toBe(12);
  });

  it("no devuelve negativos ni valores inválidos", () => {
    expect(
      minutesSince("2026-11-21T11:00:00.000Z", "2026-11-21T10:00:00.000Z"),
    ).toBe(0);
    expect(minutesSince(null, "2026-11-21T10:00:00.000Z")).toBeNull();
    expect(minutesSince("no es fecha", "2026-11-21T10:00:00.000Z")).toBeNull();
  });
});
