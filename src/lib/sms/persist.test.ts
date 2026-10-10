import { describe, expect, it } from "vitest";

import { extractInboundSms, extractGatewayMessageId } from "./persist";

describe("extractInboundSms", () => {
  it("reads the get-received-sms shape (_id / sender / message / receivedAt)", () => {
    const rec = extractInboundSms({
      _id: "abc123",
      sender: "+584241234567",
      message: "Hola",
      receivedAt: "2026-01-02T10:00:00.000Z",
    });
    expect(rec).not.toBeNull();
    expect(rec!.phone).toBe("+584241234567");
    expect(rec!.text).toBe("Hola");
    expect(rec!.messageId).toBe("abc123");
    expect(rec!.receivedAt).toBe("2026-01-02T10:00:00.000Z");
  });

  it("accepts the newer /gateway/messages aliases", () => {
    const rec = extractInboundSms({
      id: "xyz",
      from: "+14155550123",
      body: "Hi there",
      createdAt: "2026-01-02T10:00:00.000Z",
    });
    expect(rec!.phone).toBe("+14155550123");
    expect(rec!.text).toBe("Hi there");
    expect(rec!.messageId).toBe("xyz");
  });

  it("rejects items without a sender", () => {
    expect(extractInboundSms({ message: "no phone" })).toBeNull();
    expect(extractInboundSms(null)).toBeNull();
    expect(extractInboundSms("nope")).toBeNull();
  });

  it("falls back to now() for a missing or invalid timestamp", () => {
    const rec = extractInboundSms({ sender: "+1", message: "x" });
    expect(Number.isNaN(Date.parse(rec!.receivedAt))).toBe(false);
  });
});

describe("extractGatewayMessageId", () => {
  it("pulls an id out of the common textbee send shapes", () => {
    expect(extractGatewayMessageId({ data: { _id: "m1" } })).toBe("m1");
    expect(extractGatewayMessageId({ data: [{ _id: "m2" }] })).toBe("m2");
    expect(extractGatewayMessageId({ messageId: "m3" })).toBe("m3");
  });

  it("returns null when there is no usable id", () => {
    expect(extractGatewayMessageId(null)).toBeNull();
    expect(extractGatewayMessageId({ data: { smsBatchId: "batch" } })).toBeNull();
    expect(extractGatewayMessageId({})).toBeNull();
  });
});
