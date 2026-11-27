import { describe, expect, it } from "vitest";

import {
  defaultReminderSettings,
  emailHtml,
  localDateInZone,
  localHourInZone,
  normalizeReminderSettings,
  reminderKindFor,
  reminderKindLabel,
  reminderStateText,
  renderReminderText,
  renderWhatsappPreview,
  whatsappParamsFor,
  whatsappValues,
  type ReminderCandidate,
} from "./reminders-shared";

const candidate: ReminderCandidate = {
  installment_id: "11111111-1111-1111-1111-111111111111",
  credit_id: "22222222-2222-2222-2222-222222222222",
  debtor_id: "33333333-3333-3333-3333-333333333333",
  debtor_name: "María Pérez",
  phone: "+584141234567",
  email: "maria@example.com",
  installment_number: 4,
  due_date: "2026-03-10",
  days_delta: 3,
  kind: "before_due",
  balance: 125.5,
  currency: "USD",
  business_name: "Comercial Andina",
  whatsapp_sent: false,
  email_sent: false,
};

describe("reminderKindFor", () => {
  it("marca los tres peldaños configurados", () => {
    expect(reminderKindFor(3, 3, 5)).toBe("before_due");
    expect(reminderKindFor(0, 3, 5)).toBe("on_due");
    expect(reminderKindFor(-5, 3, 5)).toBe("after_due");
  });

  it("no marca días fuera de la escalera", () => {
    expect(reminderKindFor(4, 3, 5)).toBeNull();
    expect(reminderKindFor(-4, 3, 5)).toBeNull();
    expect(reminderKindFor(10, 3, 5)).toBeNull();
  });

  it("respeta una escalera distinta por negocio", () => {
    expect(reminderKindFor(7, 7, 10)).toBe("before_due");
    expect(reminderKindFor(-10, 7, 10)).toBe("after_due");
  });
});

describe("reminderKindLabel", () => {
  it("incluye los días configurados", () => {
    expect(
      reminderKindLabel("before_due", { days_before: 3, days_after: 5 }),
    ).toBe("Antes del vencimiento (3 días)");
    expect(reminderKindLabel("on_due")).toBe("Día del vencimiento");
    expect(
      reminderKindLabel("after_due", { days_before: 3, days_after: 7 }),
    ).toBe("Después del vencimiento (7 días)");
  });

  it("singulariza un solo día", () => {
    expect(
      reminderKindLabel("before_due", { days_before: 1, days_after: 5 }),
    ).toBe("Antes del vencimiento (1 día)");
  });
});

describe("reminderStateText", () => {
  it("describe el momento de la cuota", () => {
    expect(reminderStateText({ days_delta: 3 })).toBe(
      "Faltan 3 días para el vencimiento.",
    );
    expect(reminderStateText({ days_delta: 1 })).toBe(
      "Falta 1 día para el vencimiento.",
    );
    expect(reminderStateText({ days_delta: 0 })).toBe("La cuota vence hoy.");
    expect(reminderStateText({ days_delta: -5 })).toBe(
      "La cuota tiene 5 días de mora.",
    );
    expect(reminderStateText({ days_delta: -1 })).toBe(
      "La cuota tiene 1 día de mora.",
    );
  });
});

describe("renderReminderText", () => {
  it("reemplaza los marcadores con datos reales", () => {
    const text = renderReminderText(
      "Hola {{deudor}}, tu cuota {{cuota}} de {{negocio}} por {{monto}} vence el {{vencimiento}}. {{estado}}",
      candidate,
    );
    expect(text).toContain("Hola María Pérez");
    expect(text).toContain("tu cuota 4");
    expect(text).toContain("Comercial Andina");
    expect(text).toContain("125,50");
    expect(text).toContain("10/03/2026");
    expect(text).toContain("Faltan 3 días para el vencimiento.");
  });

  it("acepta el alias {{nombre}} y deja intactos los marcadores desconocidos", () => {
    expect(renderReminderText("{{nombre}} / {{otro}}", candidate)).toBe(
      "María Pérez / {{otro}}",
    );
  });
});

describe("whatsappParamsFor", () => {
  it("ordena las variables como documenta la UI", () => {
    expect(whatsappValues(candidate)[0]).toBe("María Pérez");
    expect(whatsappValues(candidate)[1]).toBe("Comercial Andina");
    expect(whatsappValues(candidate)[3]).toBe("10/03/2026");
  });

  it("recorta las variables al número que pide la plantilla", () => {
    expect(whatsappParamsFor("Hola {{1}}", candidate)).toEqual({
      ok: true,
      params: ["María Pérez"],
    });
    const result = whatsappParamsFor(
      "Hola {{1}}, debes {{2}} el {{3}}",
      candidate,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.slice(0, 2)).toEqual([
        "María Pérez",
        "Comercial Andina",
      ]);
      // Intl usa un espacio duro entre la moneda y el monto.
      expect(result.params[2].replace(/\u00a0/g, " ")).toBe("USD 125,50");
    }
  });

  it("rechaza plantillas con saltos entre variables", () => {
    const result = whatsappParamsFor("{{1}} y {{3}}", candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("secuenciales");
    }
  });

  it("rechaza plantillas con más de cuatro variables", () => {
    const result = whatsappParamsFor(
      "{{1}} {{2}} {{3}} {{4}} {{5}}",
      candidate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("5 variables");
    }
  });

  it("acepta una plantilla sin variables", () => {
    expect(whatsappParamsFor("Recordatorio de pago", candidate)).toEqual({
      ok: true,
      params: [],
    });
  });
});

describe("renderWhatsappPreview", () => {
  it("reemplaza las variables y conserva las que faltan", () => {
    expect(renderWhatsappPreview("{{1}} · {{2}} · {{3}}", ["Ana"])).toBe(
      "Ana · {{2}} · {{3}}",
    );
  });
});

describe("normalizeReminderSettings", () => {
  it("usa los valores por defecto de la escalera", () => {
    const settings = normalizeReminderSettings({ account_id: "acc" });
    expect(settings.days_before).toBe(3);
    expect(settings.days_after).toBe(5);
    expect(settings.send_hour).toBe(9);
    expect(settings.enabled).toBe(false);
    expect(settings.email_body).toContain("{{deudor}}");
  });

  it("limita los rangos y redondea", () => {
    const settings = normalizeReminderSettings({
      account_id: "acc",
      days_before: 99,
      days_after: 0,
      send_hour: 30,
      max_per_run: 5000,
    });
    expect(settings.days_before).toBe(30);
    expect(settings.days_after).toBe(1);
    expect(settings.send_hour).toBe(23);
    expect(settings.max_per_run).toBe(2000);
  });

  it("conserva la última corrida al guardar", () => {
    const existing = {
      ...defaultReminderSettings("acc"),
      last_run_at: "2026-03-10T13:00:00.000Z",
      last_run_summary: {
        date: "2026-03-10",
        dry_run: false,
        candidates: 2,
        sent: 2,
        failed: 0,
        skipped: 0,
        items: [],
        reasons: {},
        ran_at: "2026-03-10T13:00:00.000Z",
      },
    };
    const settings = normalizeReminderSettings(
      { account_id: "acc", days_after: 7 },
      existing,
    );
    expect(settings.days_after).toBe(7);
    expect(settings.last_run_at).toBe(existing.last_run_at);
    expect(settings.last_run_summary?.sent).toBe(2);
  });
});

describe("zonas horarias", () => {
  it("calcula la fecha y hora local del negocio", () => {
    const lateUtc = new Date("2026-03-10T02:30:00.000Z");
    expect(localDateInZone("America/Caracas", lateUtc)).toBe("2026-03-09");
    expect(localHourInZone("America/Caracas", lateUtc)).toBe(22);

    const morningUtc = new Date("2026-03-10T13:05:00.000Z");
    expect(localDateInZone("America/Caracas", morningUtc)).toBe("2026-03-10");
    expect(localHourInZone("America/Caracas", morningUtc)).toBe(9);
  });

  it("cae a Caracas si la zona es inválida", () => {
    const at = new Date("2026-03-10T13:05:00.000Z");
    expect(localDateInZone("Zona/Inventada", at)).toBe(
      localDateInZone("America/Caracas", at),
    );
  });
});

describe("emailHtml", () => {
  it("escapa el contenido y respeta los saltos de línea", () => {
    const html = emailHtml("Hola <b>Ana</b>\nSaldo & pendiente");
    expect(html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(html).toContain("Saldo &amp; pendiente");
    expect(html).toContain("<br />");
  });
});
