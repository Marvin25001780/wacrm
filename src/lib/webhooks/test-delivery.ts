import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

import { decrypt } from '@/lib/whatsapp/encryption'
import { buildSignatureHeader } from '@/lib/webhooks/sign'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import type { WebhookEvent } from '@/lib/webhooks/events'

// ============================================================
// Entrega de prueba (síncrona) para el botón "Probar" del panel.
//
// A diferencia de `dispatchWebhookEvent` (best-effort, en `after()`),
// esta función espera la respuesta y la devuelve, para que el usuario
// vea el código HTTP real. NO toca `failure_count` — una prueba no debe
// desactivar el endpoint. Sí actualiza `last_delivery_at` en éxito.
// ============================================================

export const TEST_DELIVERY_TIMEOUT_MS = 5000

export interface TestDeliveryResult {
  ok: boolean
  status: number | null
  error?: string
}

export async function deliverTestEvent(
  db: SupabaseClient,
  accountId: string,
  endpointId: string,
  event: WebhookEvent,
  data: unknown,
): Promise<TestDeliveryResult> {
  const { data: row, error } = await db
    .from('webhook_endpoints')
    .select('id, url, secret')
    .eq('id', endpointId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    console.error('[webhooks/test] load error:', error)
    return { ok: false, status: null, error: 'No se pudo cargar el endpoint' }
  }
  if (!row) return { ok: false, status: null, error: 'Endpoint no encontrado' }

  const target = row as { id: string; url: string; secret: string }

  if (!(await isDeliverableUrl(target.url))) {
    return {
      ok: false,
      status: null,
      error: 'La URL no es un destino público válido (bloqueada por seguridad)',
    }
  }

  let secret: string
  try {
    secret = decrypt(target.secret)
  } catch {
    return { ok: false, status: null, error: 'No se pudo descifrar el secreto' }
  }

  const payload = JSON.stringify({
    id: randomUUID(),
    event,
    occurred_at: new Date().toISOString(),
    account_id: accountId,
    test: true,
    data,
  })
  const tsSeconds = Math.floor(Date.now() / 1000)

  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wacrm-Event': event,
        'X-Wacrm-Webhook-Id': target.id,
        'X-Wacrm-Signature': buildSignatureHeader(payload, secret, tsSeconds),
      },
      body: payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(TEST_DELIVERY_TIMEOUT_MS),
    })

    if (res.ok) {
      await db
        .from('webhook_endpoints')
        .update({ last_delivery_at: new Date().toISOString() })
        .eq('id', target.id)
      return { ok: true, status: res.status }
    }
    return { ok: false, status: res.status, error: `El endpoint respondió ${res.status}` }
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : 'Error de red',
    }
  }
}
