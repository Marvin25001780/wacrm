import { describe, expect, it } from "vitest";

import {
  TEMPLATE_EXAMPLE,
  TEMPLATE_FIELDS,
  autoMapColumns,
  missingRequiredFields,
} from "./columns";
import { normalizeImportRow } from "./normalize";
import { buildImportPreview } from "./validate";
import { parseCollectionFile } from "./parse";
import {
  autoMapPaymentColumns,
  buildPaymentPreview,
  installmentKey,
  missingPaymentFields,
  type PaymentInstallmentRef,
} from "./payments";

function templateRow(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {};
  TEMPLATE_FIELDS.forEach((field, index) => {
    row[field.label] = TEMPLATE_EXAMPLE[index];
  });
  return { ...row, ...overrides };
}

describe("plantilla de cartera", () => {
  it("mapea las 11 columnas de la plantilla sin cruzar mora con total", () => {
    const headers = TEMPLATE_FIELDS.map((field) => field.label);
    const mapping = autoMapColumns(headers);

    expect(mapping.document_number).toBe("Documento");
    expect(mapping.name).toBe("Nombre del deudor");
    expect(mapping.folio).toBe("Folio del crédito");
    expect(mapping.installment_number).toBe("Número de cuota");
    expect(mapping.due_date).toBe("Fecha de vencimiento");
    expect(mapping.late_fee).toBe("Mora / recargo");
    expect(mapping.total).toBe("Total de la cuota");
    expect(mapping.notes).toBe("Notas");
    expect(missingRequiredFields(mapping)).toEqual([]);
  });

  it("calcula el capital restando mora al total cuando no hay columna de capital", () => {
    const mapping = autoMapColumns(TEMPLATE_FIELDS.map((field) => field.label));
    const result = normalizeImportRow(
      templateRow({ "Mora / recargo": "50", "Total de la cuota": "550" }),
      mapping,
    );

    expect(result.errors).toEqual([]);
    expect(result.normalized?.principal).toBe(500);
    expect(result.normalized?.late_fee).toBe(50);
    expect(result.normalized?.interest).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("marca duplicados dentro del mismo archivo", () => {
    const mapping = autoMapColumns(TEMPLATE_FIELDS.map((field) => field.label));
    const sheet = {
      headers: TEMPLATE_FIELDS.map((field) => field.label),
      rows: [templateRow(), templateRow()],
    };
    const preview = buildImportPreview(sheet, mapping);

    expect(preview.summary.total).toBe(2);
    expect(preview.summary.valid).toBe(1);
    expect(preview.summary.error).toBe(1);
  });
});

describe("lectura de archivos", () => {
  it("lee un CSV de Excel en español: BOM, punto y coma y decimales con coma", async () => {
    const csv =
      "\uFEFFDocumento;Nombre del deudor;Folio del crédito;Número de cuota;Fecha de vencimiento;Mora / recargo;Total de la cuota\n" +
      "V-1;Juan Pérez;CR-1;1;15/11/2026;0;550,50\n";
    const buffer = new TextEncoder().encode(csv).buffer;

    const sheet = await parseCollectionFile("cartera.csv", buffer);

    expect(sheet.headers[0]).toBe("Documento");
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]["Total de la cuota"]).toBe("550,50");
  });

  it("rechaza .xls con un mensaje accionable", async () => {
    await expect(parseCollectionFile("cartera.xls", new ArrayBuffer(0))).rejects.toThrow(
      /Excel 97-2003/,
    );
  });

  it("acepta la línea sep= que agrega Excel", async () => {
    const csv = "sep=;\nDocumento;Nombre del deudor\nV-1;Ana\n";
    const sheet = await parseCollectionFile(
      "cartera.csv",
      new TextEncoder().encode(csv).buffer,
    );

    expect(sheet.headers).toEqual(["Documento", "Nombre del deudor"]);
    expect(sheet.rows[0].Documento).toBe("V-1");
  });
});

describe("importación de pagos", () => {
  const headers = [
    "Documento",
    "Folio del crédito",
    "Número de cuota",
    "Monto",
    "Fecha de pago",
    "Método",
    "Referencia",
    "Notas",
  ];

  const ref: PaymentInstallmentRef = {
    installment_id: "inst-1",
    credit_id: "credit-1",
    debtor_id: "debtor-1",
    debtor_name: "Juan Pérez",
    document_number: "V-12345678",
    folio: "CR-001",
    installment_number: 1,
    balance: 550,
  };

  function paymentRow(overrides: Record<string, unknown> = {}) {
    return {
      Documento: "V-12345678",
      "Folio del crédito": "CR-001",
      "Número de cuota": "1",
      Monto: "550,00",
      "Fecha de pago": "24/10/2026",
      Método: "transferencia",
      Referencia: "REF-1",
      Notas: "",
      ...overrides,
    };
  }

  it("mapea las columnas de la plantilla de pagos", () => {
    const mapping = autoMapPaymentColumns(headers);

    expect(mapping.folio).toBe("Folio del crédito");
    expect(mapping.installment_number).toBe("Número de cuota");
    expect(mapping.amount).toBe("Monto");
    expect(mapping.paid_at).toBe("Fecha de pago");
    expect(missingPaymentFields(mapping)).toEqual([]);
  });

  it("resuelve la cuota y normaliza monto, fecha y método", () => {
    const refs = new Map([[installmentKey("CR-001", 1), ref]]);
    const preview = buildPaymentPreview(
      { headers, rows: [paymentRow()] },
      autoMapPaymentColumns(headers),
      refs,
    );

    expect(preview.summary).toEqual({ total: 1, valid: 1, warning: 0, error: 0 });
    expect(preview.rows[0].normalized).toMatchObject({
      folio: "CR-001",
      installment_number: 1,
      amount: 550,
      paid_at: "2026-10-24",
      method: "transfer",
      installment_id: "inst-1",
    });
  });

  it("rechaza cuotas inexistentes y montos que exceden el saldo", () => {
    const refs = new Map([[installmentKey("CR-001", 1), ref]]);
    const preview = buildPaymentPreview(
      {
        headers,
        rows: [
          paymentRow({ "Folio del crédito": "CR-999" }),
          paymentRow({ Monto: "900,00" }),
        ],
      },
      autoMapPaymentColumns(headers),
      refs,
    );

    expect(preview.summary.error).toBe(2);
    expect(preview.rows[0].errors[0]).toMatch(/No existe la cuota/);
    expect(preview.rows[1].errors[0]).toMatch(/excede el saldo/);
  });

  it("detecta dos pagos del mismo archivo que juntos exceden el saldo", () => {
    const refs = new Map([[installmentKey("CR-001", 1), ref]]);
    const preview = buildPaymentPreview(
      {
        headers,
        rows: [paymentRow({ Monto: "400" }), paymentRow({ Monto: "400" })],
      },
      autoMapPaymentColumns(headers),
      refs,
    );

    expect(preview.rows[0].status).toBe("warning");
    expect(preview.rows[1].status).toBe("error");
    expect(preview.rows[1].errors[0]).toMatch(/excede el saldo/);
  });

  it("avisa cuando el documento no coincide con el del crédito", () => {
    const refs = new Map([[installmentKey("CR-001", 1), ref]]);
    const preview = buildPaymentPreview(
      { headers, rows: [paymentRow({ Documento: "V-99999999" })] },
      autoMapPaymentColumns(headers),
      refs,
    );

    expect(preview.rows[0].status).toBe("warning");
    expect(preview.rows[0].warnings[0]).toMatch(/documento no coincide/);
  });
});
