import { describe, expect, it } from "vitest";

import {
  detectImageMime,
  isUsdOrUnknown,
  normalizeOcrCurrency,
  normalizeReceiptBank,
  normalizeReceiptDate,
  normalizeReceiptReference,
  parseReceiptAmount,
} from "./receipt-capture-shared";

describe("parseReceiptAmount", () => {
  it("lee el formato venezolano de miles y coma decimal", () => {
    expect(parseReceiptAmount("1.234,56")).toBe(1234.56);
    expect(parseReceiptAmount("Bs. 1.234,56")).toBe(1234.56);
  });

  it("lee el formato inglés de coma de miles y punto decimal", () => {
    expect(parseReceiptAmount("1,234.56")).toBe(1234.56);
    expect(parseReceiptAmount("$1,234.56")).toBe(1234.56);
  });

  it("interpreta tres dígitos detrás de un solo separador como miles", () => {
    expect(parseReceiptAmount("1.234")).toBe(1234);
    expect(parseReceiptAmount("1,234")).toBe(1234);
    expect(parseReceiptAmount("50.000")).toBe(50000);
  });

  it("acepta punto o coma decimal simple", () => {
    expect(parseReceiptAmount("1234.56")).toBe(1234.56);
    expect(parseReceiptAmount("1234,56")).toBe(1234.56);
    expect(parseReceiptAmount("0,50")).toBe(0.5);
    expect(parseReceiptAmount(",50")).toBe(0.5);
  });

  it("acepta números y texto con prefijo de moneda", () => {
    expect(parseReceiptAmount(50)).toBe(50);
    expect(parseReceiptAmount("USD 50")).toBe(50);
    expect(parseReceiptAmount(" 20,00 USD ")).toBe(20);
  });

  it("rechaza lo que no es un monto positivo", () => {
    expect(parseReceiptAmount(null)).toBeNull();
    expect(parseReceiptAmount("")).toBeNull();
    expect(parseReceiptAmount("sin monto")).toBeNull();
    expect(parseReceiptAmount("-10")).toBeNull();
    expect(parseReceiptAmount(-10)).toBeNull();
    expect(parseReceiptAmount(0)).toBeNull();
  });

  it("redondea a centavos", () => {
    expect(parseReceiptAmount(10.005)).toBe(10.01);
    expect(parseReceiptAmount(10.004)).toBe(10);
  });
});

describe("normalizeOcrCurrency", () => {
  it("reconoce dólares", () => {
    expect(normalizeOcrCurrency("USD")).toBe("USD");
    expect(normalizeOcrCurrency(" us$ ")).toBe("USD");
    expect(normalizeOcrCurrency("$")).toBe("USD");
    expect(normalizeOcrCurrency("Dólares")).toBe("USD");
  });

  it("reconoce bolívares", () => {
    expect(normalizeOcrCurrency("VES")).toBe("VES");
    expect(normalizeOcrCurrency("Bs.")).toBe("VES");
    expect(normalizeOcrCurrency("bolívares")).toBe("VES");
  });

  it("no inventa moneda cuando no es legible", () => {
    expect(normalizeOcrCurrency(null)).toBeNull();
    expect(normalizeOcrCurrency("moneda local")).toBeNull();
  });
});

describe("isUsdOrUnknown", () => {
  it("solo deja pasar USD o moneda desconocida", () => {
    expect(isUsdOrUnknown("USD")).toBe(true);
    expect(isUsdOrUnknown(null)).toBe(true);
    expect(isUsdOrUnknown("VES")).toBe(false);
  });
});

describe("normalizeReceiptReference", () => {
  it("limpia espacios y acota el texto", () => {
    expect(normalizeReceiptReference("  123  456 ")).toBe("123 456");
    expect(normalizeReceiptReference("")).toBeNull();
    expect(normalizeReceiptReference(null)).toBeNull();
    expect(normalizeReceiptReference("x".repeat(200))).toHaveLength(80);
  });
});

describe("normalizeReceiptBank", () => {
  it("limpia y acota el banco", () => {
    expect(normalizeReceiptBank("  Banco   de Venezuela ")).toBe(
      "Banco de Venezuela",
    );
    expect(normalizeReceiptBank("   ")).toBeNull();
    expect(normalizeReceiptBank("b".repeat(300))).toHaveLength(120);
  });
});

describe("normalizeReceiptDate", () => {
  it("acepta ISO, DD/MM/AAAA y DD-MM-AAAA", () => {
    expect(normalizeReceiptDate("2026-03-15")).toBe("2026-03-15");
    expect(normalizeReceiptDate("2026-03-15T10:30:00Z")).toBe("2026-03-15");
    expect(normalizeReceiptDate("15/03/2026")).toBe("2026-03-15");
    expect(normalizeReceiptDate("5-3-2026")).toBe("2026-03-05");
  });

  it("rechaza fechas imposibles o con otro formato", () => {
    expect(normalizeReceiptDate("31/02/2026")).toBeNull();
    expect(normalizeReceiptDate("2026-13-01")).toBeNull();
    expect(normalizeReceiptDate("marzo 15")).toBeNull();
    expect(normalizeReceiptDate(null)).toBeNull();
  });
});

describe("detectImageMime", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const gif = Buffer.from("GIF89a", "ascii");

  it("detecta PNG por firma", () => {
    expect(detectImageMime(png, "application/octet-stream")).toBe("image/png");
  });

  it("detecta JPEG por firma", () => {
    expect(detectImageMime(jpeg, "")).toBe("image/jpeg");
  });

  it("detecta WEBP por firma", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x20, 0x00, 0x00, 0x00]),
      Buffer.from("WEBPVP8 ", "ascii"),
    ]);
    expect(detectImageMime(webp, "image/jpeg")).toBe("image/webp");
  });

  it("detecta GIF por firma", () => {
    expect(detectImageMime(gif, "image/jpeg")).toBe("image/gif");
  });

  it("conserva el MIME declarado si no reconoce la firma", () => {
    expect(detectImageMime(Buffer.from([1, 2, 3]), "image/heic")).toBe(
      "image/heic",
    );
  });
});
