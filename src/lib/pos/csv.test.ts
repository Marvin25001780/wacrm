import { describe, expect, it } from "vitest";

import {
  csvNumber,
  csvQuantity,
  detectDelimiter,
  normalizeHeader,
  parseBool,
  parseCsv,
  toCsv,
} from "./csv";

describe("parseCsv", () => {
  it("detecta punto y coma como separador", () => {
    expect(detectDelimiter("nombre;precio\nCafé;5,00")).toBe(";");
  });

  it("lee comillas, comas internas y saltos de línea", () => {
    const rows = parseCsv('nombre;detalle\r\n"Café, molido";"Bolsa ""250 g"""\r\n');

    expect(rows).toEqual([
      ["nombre", "detalle"],
      ["Café, molido", 'Bolsa "250 g"'],
    ]);
  });

  it("quita el BOM de Excel", () => {
    expect(parseCsv("\uFEFFnombre;precio\nCafé;5")).toEqual([
      ["nombre", "precio"],
      ["Café", "5"],
    ]);
  });
});

describe("normalizeHeader", () => {
  it("quita acentos, espacios y signos", () => {
    expect(normalizeHeader("Código de barras")).toBe("codigo_de_barras");
    expect(normalizeHeader("  Precio USD ")).toBe("precio_usd");
  });
});

describe("parseBool", () => {
  it("entiende sí, no y números", () => {
    expect(parseBool("Sí", false)).toBe(true);
    expect(parseBool("x", false)).toBe(true);
    expect(parseBool("1", false)).toBe(true);
    expect(parseBool("No", true)).toBe(false);
    expect(parseBool("", true)).toBe(true);
  });
});

describe("toCsv", () => {
  it("escapa el separador y las comillas", () => {
    expect(toCsv([["Café; molido", 'Bolsa "250 g"']])).toBe(
      '"Café; molido";"Bolsa ""250 g"""',
    );
  });
});

describe("formatos numéricos", () => {
  it("usa coma decimal", () => {
    expect(csvNumber(1234.5)).toBe("1234,50");
    expect(csvQuantity(3)).toBe("3");
    expect(csvQuantity(12)).toBe("12");
    expect(csvQuantity(0)).toBe("0");
    expect(csvQuantity(1.25)).toBe("1,25");
  });
});
