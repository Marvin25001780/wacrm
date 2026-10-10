/**
 * textbee.dev gateway client.
 *
 * All SMS traffic goes through the account's own textbee device and API
 * key. The key is decrypted server-side (see `./config.ts`) and never
 * reaches the browser.
 */

export const TEXTBEE_API =
  'https://api.textbee.dev/api/v1/gateway/devices'

/** Normalise a phone number to E.164-ish form (Venezuela `58` default). */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('58') && digits.length >= 11) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

export type TextbeeResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string }

async function textbeeRequest(
  url: string,
  apiKey: string,
  init: RequestInit,
  timeoutMs = 20000,
): Promise<{ status: number; ok: boolean; text: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'x-api-key': apiKey, ...(init.headers ?? {}) },
    })
    const text = await res.text().catch(() => '')
    return { status: res.status, ok: res.ok, text }
  } finally {
    clearTimeout(timeout)
  }
}

function parseJson<T>(text: string, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/** Send a single SMS through the account's textbee device. */
export async function textbeeSendSms(
  deviceId: string,
  apiKey: string,
  to: string,
  message: string,
): Promise<TextbeeResult> {
  try {
    const res = await textbeeRequest(`${TEXTBEE_API}/${deviceId}/send-sms`, apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: [formatPhone(to)], message }),
    })
    if (!res.ok) {
      return { ok: false, status: res.status, error: res.text || 'textbee rejected the request' }
    }
    return { ok: true, status: res.status, data: parseJson<unknown>(res.text, null) }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : 'Network error contacting textbee',
    }
  }
}

/** Fetch recently received SMS for the account's device. */
export async function textbeeFetchReceived(
  deviceId: string,
  apiKey: string,
): Promise<TextbeeResult<unknown[]>> {
  try {
    const res = await textbeeRequest(
      `${TEXTBEE_API}/${deviceId}/get-received-sms`,
      apiKey,
      { method: 'GET' },
      15000,
    )
    if (!res.ok) {
      return { ok: false, status: res.status, error: res.text || 'textbee rejected the request' }
    }
    const parsed = parseJson<unknown>(res.text, [])
    // `get-received-sms` returns a bare array; the newer
    // `/gateway/messages` endpoint wraps it as `{ data: [...] }`.
    // Accept both so a gateway change never silently empties the feed.
    const data = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { data?: unknown }).data)
        ? ((parsed as { data: unknown[] }).data)
        : []
    return { ok: true, status: res.status, data }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : 'Network error contacting textbee',
    }
  }
}

/**
 * Best-effort credential check used when saving the config.
 *
 * A 401/403 means the key is wrong or revoked, which should block the
 * save. Any other outcome (200, 404, network hiccup) is treated as
 * "accept" so a flaky gateway never stops an admin from saving — the
 * same spirit as the WhatsApp config's verify-before-save.
 */
export async function verifyTextbeeCredentials(
  deviceId: string,
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await textbeeFetchReceived(deviceId, apiKey)
  if (result.ok) return { ok: true }
  if (result.status === 401 || result.status === 403) {
    return { ok: false, error: 'textbee rejected the API key or device id.' }
  }
  return { ok: true }
}
