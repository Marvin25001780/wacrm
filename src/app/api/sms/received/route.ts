import { NextRequest, NextResponse } from "next/server";

const TEXTBEE_API = "https://api.textbee.dev/api/v1/gateway/devices";

export async function GET(request: NextRequest) {
  try {
    const deviceId = request.nextUrl.searchParams.get("deviceId") || process.env.TEXTBEE_DEVICE_ID;
    const apiKey = process.env.TEXTBEE_API_KEY;

    if (!apiKey || !deviceId) {
      return NextResponse.json({ messages: [] });
    }

    const res = await fetch(`${TEXTBEE_API}/${deviceId}/get-received-sms`, {
      headers: { "x-api-key": apiKey },
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
