import { describe, expect, it, vi } from "vitest";

import {
  ReceiptOcrError,
  canCaptureCurrency,
  ocrReceipt,
  parseReceiptOcrJson,
  visionProvider,
  visionProviderLabel,
} from "./receipt-ocr";

const image = Buffer.from("fake-jpeg-bytes");
const config = { provider: "openai", apiKey: "sk-test", model: null };

describe("visionProvider", () => {
  it("acepta los proveedores con visión", () => {
    expect(visionProvider("openai")).toBe("openai");
    expect(visionProvider("gemini")).toBe("gemini");
    expect(visionProvider("anthropic")).toBe("anthropic");
    expect(visionProvider("groq")).toBe("groq");
  });

  it("rechaza DeepSeek y proveedores desconocidos", () => {
    expect(visionProvider("deepseek")).toBeNull();
    expect(visionProvider("otro")).toBeNull();
    expect(visionProviderLabel("deepseek")).toBeNull();
    expect(visionProviderLabel("gemini")).toBe("Gemini");
  });
});

describe("parseReceiptOcrJson", () => {
  it("lee el JSON aunque venga dentro de un bloque markdown", () => {
    const result = parseReceiptOcrJson(
      '```json\n{"is_receipt":true,"amount":"1.234,56","currency":"USD","reference":" 0012 3456 ","bank":"Banesco","paid_at":"15/03/2026","confidence":0.92,"notes":"Zelle"}\n```',
    );

    expect(result.isReceipt).toBe(true);
    expect(result.amount).toBe(1234.56);
    expect(result.currency).toBe("USD");
    expect(result.reference).toBe("0012 3456");
    expect(result.bank).toBe("Banesco");
    expect(result.paidAt).toBe("2026-03-15");
    expect(result.confidence).toBe(0.92);
    expect(result.notes).toBe("Zelle");
  });

  it("marca un comprobante en bolívares como VES", () => {
    const result = parseReceiptOcrJson(
      '{"is_receipt":true,"amount":500000,"currency":"Bs.","reference":null,"bank":null,"paid_at":null,"confidence":90,"notes":null}',
    );
    expect(result.currency).toBe("VES");
    expect(result.confidence).toBe(0.9);
    expect(canCaptureCurrency(result.currency)).toBe(false);
  });

  it("trata is_receipt como falso si no es explícito", () => {
    const result = parseReceiptOcrJson(
      '{"is_receipt":false,"amount":null,"currency":null}',
    );
    expect(result.isReceipt).toBe(false);
    expect(result.amount).toBeNull();
    expect(result.currency).toBeNull();
  });

  it("acepta is_receipt en texto", () => {
    expect(parseReceiptOcrJson('{"is_receipt":"true"}').isReceipt).toBe(true);
  });

  it("falla con un motivo estable si no hay JSON", () => {
    expect(() => parseReceiptOcrJson("no pude leer la imagen")).toThrow(
      ReceiptOcrError,
    );
    try {
      parseReceiptOcrJson("no pude leer la imagen");
    } catch (error) {
      expect((error as ReceiptOcrError).code).toBe("invalid_response");
    }
  });

  it("falla si el JSON está truncado", () => {
    try {
      parseReceiptOcrJson('{"is_receipt":true,"amount":');
      throw new Error("debió lanzar");
    } catch (error) {
      expect(error).toBeInstanceOf(ReceiptOcrError);
      expect((error as ReceiptOcrError).code).toBe("invalid_response");
    }
  });
});

describe("ocrReceipt", () => {
  it("omite el OCR si el proveedor no lee imágenes", async () => {
    await expect(
      ocrReceipt({
        config: { ...config, provider: "deepseek" },
        buffer: image,
        mimeType: "image/jpeg",
      }),
    ).rejects.toMatchObject({ code: "provider_without_vision" });
  });

  it("rechaza archivos que no son imagen", async () => {
    await expect(
      ocrReceipt({
        config,
        buffer: image,
        mimeType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "unsupported_mime" });
  });

  it("rechaza imágenes vacías o enormes", async () => {
    await expect(
      ocrReceipt({ config, buffer: Buffer.alloc(0), mimeType: "image/jpeg" }),
    ).rejects.toMatchObject({ code: "empty_media" });

    await expect(
      ocrReceipt({
        config,
        buffer: Buffer.alloc(13 * 1024 * 1024),
        mimeType: "image/jpeg",
      }),
    ).rejects.toMatchObject({ code: "media_too_large" });
  });

  it("envía la imagen a OpenAI y devuelve el comprobante", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"is_receipt":true,"amount":50,"currency":"USD","reference":"998877","bank":"Banesco","paid_at":"2026-03-15","confidence":0.8,"notes":null}',
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await ocrReceipt({
      config,
      buffer: image,
      mimeType: "image/jpeg",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.amount).toBe(50);
    expect(result.reference).toBe("998877");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("api.openai.com");
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ content: unknown }>;
    };
    const parts = body.messages[1].content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(parts[1].image_url?.url).toContain("data:image/jpeg;base64,");
  });

  it("propaga el rechazo del proveedor", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("invalid api key", { status: 401 }),
    );

    await expect(
      ocrReceipt({
        config,
        buffer: image,
        mimeType: "image/jpeg",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "ocr_rejected", status: 401 });
  });
});
