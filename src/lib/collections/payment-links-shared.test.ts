import { describe, expect, it } from "vitest";

import {
  defaultPaymentSettings,
  instructionRows,
  normalizePaymentSettings,
  paymentLinkReasonLabel,
  paymentLinkUrl,
  phoneDigits,
  receiptStatusLabel,
  referenceError,
  type PaymentInstructions,
} from "./payment-links-shared";

const instructions: PaymentInstructions = {
  enabled: true,
  bank_name: "Banesco",
  account_number: "0134 0000 0000 0000 0000",
  account_type: "Corriente",
  account_holder: "Comercial Andina C.A.",
  holder_document: "J-12345678-9",
  mobile_payment_phone: "0414 1234567",
  mobile_payment_bank: "Banesco",
  support_phone: "+58 414 1234567",
  notes: "Envía el comprobante el mismo día.",
};

describe("paymentLinkUrl", () => {
  it("une la base y el token sin doble barra", () => {
    expect(paymentLinkUrl("https://crm.example.com/", "abc123")).toBe(
      "https://crm.example.com/pagar/abc123",
    );
    expect(paymentLinkUrl("https://crm.example.com", "abc123")).toBe(
      "https://crm.example.com/pagar/abc123",
    );
  });

  it("escapa el token en la ruta", () => {
    expect(paymentLinkUrl("https://crm.example.com", "a/b c")).toBe(
      "https://crm.example.com/pagar/a%2Fb%20c",
    );
  });
});

describe("instructionRows", () => {
  it("arma filas legibles solo con los datos cargados", () => {
    const rows = instructionRows(instructions);
    expect(rows.map((row) => row.label)).toEqual([
      "Banco",
      "Cuenta",
      "Tipo de cuenta",
      "Titular",
      "Documento",
      "Pago móvil",
    ]);
    expect(rows.find((row) => row.label === "Pago móvil")?.value).toBe(
      "Banesco · 0414 1234567",
    );
  });

  it("no inventa filas vacías", () => {
    expect(
      instructionRows({
        ...instructions,
        bank_name: null,
        account_number: null,
        account_type: null,
        account_holder: null,
        holder_document: null,
        mobile_payment_phone: null,
      }),
    ).toEqual([]);
  });
});

describe("referenceError", () => {
  it("exige una referencia razonable", () => {
    expect(referenceError("")).toBe(
      "Escribe la referencia de la transferencia.",
    );
    expect(referenceError("  ab  ")).toBe(
      "La referencia es demasiado corta.",
    );
    expect(referenceError("1234567890")).toBeNull();
    expect(referenceError("x".repeat(81))).toBe(
      "La referencia no puede pasar de 80 caracteres.",
    );
  });
});

describe("normalizePaymentSettings", () => {
  it("usa los valores por defecto y apaga el enlace", () => {
    const settings = normalizePaymentSettings({ account_id: "acc" });
    expect(settings.account_id).toBe("acc");
    expect(settings.enabled).toBe(false);
    expect(settings.link_expiry_days).toBe(7);
    expect(settings.bank_name).toBeNull();
  });

  it("recorta textos, limita la vigencia y conserva lo no enviado", () => {
    const existing = {
      ...defaultPaymentSettings("acc"),
      bank_name: "Banco Viejo",
      support_phone: "+58 414 0000000",
    };
    const settings = normalizePaymentSettings(
      {
        account_id: "acc",
        enabled: true,
        bank_name: "  Banesco  ",
        link_expiry_days: 999,
      },
      existing,
    );
    expect(settings.enabled).toBe(true);
    expect(settings.bank_name).toBe("Banesco");
    expect(settings.support_phone).toBe("+58 414 0000000");
    expect(settings.link_expiry_days).toBe(90);
  });

  it("convierte textos vacíos en null", () => {
    const settings = normalizePaymentSettings({
      account_id: "acc",
      account_number: "   ",
      instructions: "",
    });
    expect(settings.account_number).toBeNull();
    expect(settings.instructions).toBeNull();
  });
});

describe("etiquetas y teléfonos", () => {
  it("traduce los motivos del enlace", () => {
    expect(paymentLinkReasonLabel("expired")).toContain("venció");
    expect(paymentLinkReasonLabel("used")).toContain("pagada");
    expect(paymentLinkReasonLabel("otro")).toBe(
      "Este enlace no está disponible.",
    );
  });

  it("etiqueta los estados del comprobante", () => {
    expect(receiptStatusLabel("pending")).toBe("Pendiente");
    expect(receiptStatusLabel("approved")).toBe("Aprobado");
    expect(receiptStatusLabel("rejected")).toBe("Rechazado");
  });

  it("deja solo dígitos para el enlace de WhatsApp", () => {
    expect(phoneDigits("+58 414-123.45.67")).toBe("584141234567");
    expect(phoneDigits(null)).toBe("");
  });
});
