// ============================================================
// Cliente de Evolution API — aprovisionamiento de instancia + QR.
//
// Evolution API (basada en Baileys / WhatsApp Web) es lo que permite
// el único "QR escaneable" real: creamos una instancia, pedimos su QR
// de emparejamiento y, al escanearlo desde WhatsApp → Dispositivos
// vinculados, la instancia pasa a `open`. En ese momento guardamos la
// config del canal y registramos el webhook automáticamente.
//
// Las credenciales (base_url + apikey global) llegan desde la UI y se
// usan solo server-side; el api_key se cifra al persistir el canal.
//
// Todas las funciones devuelven resultados estructurados (nunca
// lanzan por un fallo del proveedor) para que las rutas puedan mapear
// el error a una respuesta clara.
// ============================================================

export interface EvolutionCreds {
  baseUrl: string
  apiKey: string
}

export type EvoResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string }

/** Nombre de instancia estable por cuenta (una por cuenta). */
export function evoInstanceName(accountId: string): string {
  return `nexus-${accountId.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase()}`
}

function cleanBase(baseUrl: string): string {
  return String(baseUrl || '').trim().replace(/\/+$/, '')
}

async function evoRequest(
  creds: EvolutionCreds,
  path: string,
  init: RequestInit,
  timeoutMs = 15000,
): Promise<{ status: number; ok: boolean; text: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${cleanBase(creds.baseUrl)}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        apikey: creds.apiKey,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    const text = await res.text().catch(() => '')
    return { status: res.status, ok: res.ok, text }
  } catch (e) {
    return {
      status: 0,
      ok: false,
      text: e instanceof Error ? e.message : 'network error',
    }
  } finally {
    clearTimeout(timeout)
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  if (!text) return null
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ---- QR helpers ------------------------------------------------

/** Normaliza el QR devuelto por Evolution a un data URI mostrable. */
export function qrDataUri(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const v = value.trim()
  if (v.startsWith('data:image')) return v
  // base64 crudo → PNG
  return `data:image/png;base64,${v}`
}

/** Extrae `{ qr, code }` de cualquiera de las formas de Evolution. */
export function extractQr(payload: unknown): { qr: string | null; code: string | null } {
  const root = (payload ?? {}) as Record<string, unknown>
  const qrObj = (root.qrcode ?? root) as Record<string, unknown>
  const qr =
    qrDataUri(qrObj.base64) ??
    qrDataUri(root.base64) ??
    qrDataUri((root.qrcode as Record<string, unknown> | undefined)?.base64)
  const code =
    (typeof qrObj.code === 'string' && qrObj.code) ||
    (typeof root.code === 'string' && root.code) ||
    (typeof qrObj.pairingCode === 'string' && qrObj.pairingCode) ||
    null
  return { qr, code }
}

/** Estado de conexión normalizado ('open' | 'connecting' | 'close' | ...). */
export function extractState(payload: unknown): string {
  const root = (payload ?? {}) as Record<string, unknown>
  const inst = (root.instance ?? {}) as Record<string, unknown>
  const state =
    (typeof inst.state === 'string' && inst.state) ||
    (typeof root.state === 'string' && root.state) ||
    ''
  return String(state).toLowerCase()
}

/** Extrae el id de mensaje de la respuesta de sendText de Evolution. */
export function extractMessageId(payload: unknown): string | null {
  const root = (payload ?? {}) as Record<string, unknown>
  const key = (root.key ?? {}) as Record<string, unknown>
  if (typeof key.id === 'string' && key.id) return key.id
  if (typeof root.id === 'string' && root.id) return root.id
  if (typeof root.messageId === 'string' && root.messageId) return root.messageId
  return null
}

/** Número para Evolution: solo dígitos, con código de país. */
export function evoNumber(phone: string): string {
  return String(phone || '').replace(/\D/g, '')
}

// ---- Operaciones ----------------------------------------------

/**
 * Crea la instancia (Baileys). Si ya existe, Evolution responde con un
 * error que tratamos como benigno: el llamador continúa hacia
 * `evolutionConnect` para obtener un QR fresco.
 */
export async function evolutionCreateInstance(
  creds: EvolutionCreds,
  instance: string,
): Promise<EvoResult<{ qr: string | null; code: string | null; exists: boolean }>> {
  const res = await evoRequest(creds, '/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName: instance,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    }),
  })
  if (res.ok) {
    const { qr, code } = extractQr(parseJson(res.text))
    return { ok: true, status: res.status, data: { qr, code, exists: false } }
  }
  // 403 "already in use" / 409 → ya existe; no es fatal.
  const body = (parseJson(res.text) ?? {}) as Record<string, unknown>
  const msg = String(body.message ?? body.error ?? res.text ?? '').toLowerCase()
  if (
    res.status === 403 ||
    res.status === 409 ||
    msg.includes('already') ||
    msg.includes('exist')
  ) {
    return { ok: true, status: res.status, data: { qr: null, code: null, exists: true } }
  }
  return { ok: false, status: res.status, error: msg || 'No se pudo crear la instancia' }
}

/** Pide el QR de emparejamiento (o reconexión) de la instancia. */
export async function evolutionConnect(
  creds: EvolutionCreds,
  instance: string,
): Promise<EvoResult<{ qr: string | null; code: string | null }>> {
  const res = await evoRequest(
    creds,
    `/instance/connect/${encodeURIComponent(instance)}`,
    { method: 'GET' },
  )
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.text || 'No se pudo obtener el QR' }
  }
  return { ok: true, status: res.status, data: extractQr(parseJson(res.text)) }
}

/** Estado de conexión de la instancia. */
export async function evolutionConnectionState(
  creds: EvolutionCreds,
  instance: string,
): Promise<EvoResult<{ state: string; connected: boolean }>> {
  const res = await evoRequest(
    creds,
    `/instance/connectionState/${encodeURIComponent(instance)}`,
    { method: 'GET' },
  )
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.text || 'Sin respuesta' }
  }
  const state = extractState(parseJson(res.text))
  return { ok: true, status: res.status, data: { state, connected: state === 'open' } }
}

/**
 * Registra el webhook de ingesta apuntando a nuestro endpoint, con
 * el header `apikey` que el webhook espera. Best-effort: si Evolution
 * rechaza la forma anidada, reintenta con la plana (según versión).
 */
export async function evolutionSetWebhook(
  creds: EvolutionCreds,
  instance: string,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const payload = {
    webhook: {
      enabled: true,
      url,
      events: ['MESSAGES_UPSERT'],
      headers: { apikey: creds.apiKey },
    },
  }
  const res = await evoRequest(
    creds,
    `/webhook/set/${encodeURIComponent(instance)}`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
  if (res.ok) return { ok: true }

  // Fallback: forma plana (Evolution v1).
  const flat = {
    url,
    enabled: true,
    events: ['MESSAGES_UPSERT'],
    headers: { apikey: creds.apiKey },
  }
  const res2 = await evoRequest(
    creds,
    `/webhook/set/${encodeURIComponent(instance)}`,
    { method: 'POST', body: JSON.stringify(flat) },
  )
  if (res2.ok) return { ok: true }
  return { ok: false, error: res2.text || res.text || 'No se pudo registrar el webhook' }
}

/** Cierra la sesión de WhatsApp de la instancia (desvincular). */
export async function evolutionLogout(
  creds: EvolutionCreds,
  instance: string,
): Promise<void> {
  await evoRequest(creds, `/instance/logout/${encodeURIComponent(instance)}`, {
    method: 'DELETE',
  })
}

/** Borra la instancia por completo. */
export async function evolutionDelete(
  creds: EvolutionCreds,
  instance: string,
): Promise<void> {
  await evoRequest(creds, `/instance/delete/${encodeURIComponent(instance)}`, {
    method: 'DELETE',
  })
}

/** Comprueba credenciales listando instancias. */
export async function evolutionPing(
  creds: EvolutionCreds,
): Promise<EvoResult<unknown>> {
  const res = await evoRequest(creds, '/instance/fetchInstances', { method: 'GET' })
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.text || 'Sin conexión' }
  }
  return { ok: true, status: res.status, data: parseJson(res.text) }
}

/** Envía un texto por la instancia y devuelve el id del mensaje. */
export async function evolutionSendText(
  creds: EvolutionCreds,
  instance: string,
  number: string,
  text: string,
): Promise<EvoResult<{ messageId: string | null }>> {
  const res = await evoRequest(
    creds,
    `/message/sendText/${encodeURIComponent(instance)}`,
    {
      method: 'POST',
      body: JSON.stringify({ number: evoNumber(number), text }),
    },
  )
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.text || 'Evolution rechazó el envío' }
  }
  return { ok: true, status: res.status, data: { messageId: extractMessageId(parseJson(res.text)) } }
}

/**
 * Foto de perfil de un contacto vía Evolution / Baileys.
 *
 * Evolution expone el perfil del contacto en
 * `GET /chat/findContacts/{instance}/{jid}`; el nombre del campo de la
 * foto varía según la versión (profilePicUrl / pictureUrl / pic / ...),
 * así que probamos los más comunes. Best-effort: si no hay foto o la
 * API no lo soporta, devuelve `picUrl: null` sin error fatal.
 */
export async function evolutionContactPicture(
  creds: EvolutionCreds,
  instance: string,
  jid: string,
): Promise<EvoResult<{ picUrl: string | null }>> {
  const res = await evoRequest(
    creds,
    `/chat/findContacts/${encodeURIComponent(instance)}/${encodeURIComponent(jid)}`,
    { method: 'GET' },
  )
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.text || 'Sin respuesta' }
  }

  type maybeRecord = Record<string, unknown> | null | undefined;
  let entries: unknown[] = [];
  try {
    const parsed: unknown = res.text ? JSON.parse(res.text) : null;
    if (Array.isArray(parsed)) entries = parsed;
    else if (parsed && typeof parsed === 'object') entries = [parsed];
  } catch {
    entries = [];
  }

  const PICTURE_KEYS = ['profilePicUrl', 'pictureUrl', 'profilePicLink', 'pic', 'picture'];
  for (const raw of entries) {
    const item = raw as maybeRecord;
    if (!item) continue;
    // Evolution puede anidar bajo `contact` / `data`.
    const candidates: maybeRecord[] = [
      item,
      (item.contact as maybeRecord) ?? null,
      (item.data as maybeRecord) ?? null,
    ];
    for (const c of candidates) {
      if (!c) continue;
      for (const key of PICTURE_KEYS) {
        const v = c[key];
        if (typeof v === 'string' && v.trim() && v.startsWith('http')) {
          return { ok: true, status: res.status, data: { picUrl: v.trim() } };
        }
      }
    }
  }

  return { ok: true, status: res.status, data: { picUrl: null } };
}
