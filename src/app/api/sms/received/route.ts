import { NextResponse } from "next/server";

const TEXTBEE_API = "https://api.textbee.dev/api/v1/gateway/devices";

export async function POST(request: Request) {
  try {
    const { deviceId, apiKey } = await request.json();

    const resolvedDeviceId = deviceId || process.env.TEXTBEE_DEVICE_ID;
    const resolvedApiKey = apiKey || process.env.TEXTBEE_API_KEY;

    if (!resolvedApiKey || !resolvedDeviceId) {
      return NextResponse.json({ messages: [] });
    }

    const res = await fetch(`${TEXTBEE_API}/${resolvedDeviceId}/get-received-sms`, {
      headers: { "x-api-key": resolvedApiKey },
    });

    if (!res.ok) {
      return NextResponse.json({ messages: [] });
    }

    const data = await res.json();
    return NextResponse.json({ messages: data ?? [] });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}
