import { NextResponse } from "next/server";

const TEXTBEE_API = "https://api.textbee.dev/api/v1/gateway/devices";

export async function POST(request: Request) {
  try {
    const { to, message, deviceId } = await request.json();

    if (!to || !message) {
      return NextResponse.json({ error: "Phone and message are required" }, { status: 400 });
    }

    const apiKey = process.env.TEXTBEE_API_KEY;
    const resolvedDeviceId = deviceId || process.env.TEXTBEE_DEVICE_ID;

    if (!apiKey || !resolvedDeviceId) {
      return NextResponse.json(
        { error: "TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID must be configured" },
        { status: 400 },
      );
    }

    const res = await fetch(`${TEXTBEE_API}/${resolvedDeviceId}/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        recipients: [to],
        message,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("textbee error:", err);
      return NextResponse.json({ error: "Failed to send SMS" }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, data });
  } catch (e) {
    console.error("sms send error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
