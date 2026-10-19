import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  exchangeCodeForBusinessToken,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt } from '@/lib/whatsapp/encryption'

/**
 * POST /api/whatsapp/embedded-signup
 *
 * Completa el Embedded Signup de Meta (WhatsApp Business Platform):
 * el navegador entrega el `code` de un solo uso y los ids que devolvió
 * el popup; aquí se canjean por un token (nunca en el cliente), se
 * valida el número y se guarda todo en `whatsapp_config` — la misma
 * fila que usa el resto de la app para enviar (Cloud API) y recibir
 * (webhook `/api/whatsapp/webhook`).
 *
 * Body: { code, waba_id, phone_number_id, verify_token? }
 *
 * Requiere META_APP_ID (o NEXT_PUBLIC_META_APP_ID) y META_APP_SECRET.
 * El App Secret es imprescindible para el canje: por eso el token se
 * resuelve aquí y no en el componente.
 */

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Tu perfil no está vinculado a una cuenta.' },
        { status: 403 },
      )
    }

    const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || ''
    const appSecret = process.env.META_APP_SECRET ?? ''
    if (!appId || !appSecret) {
      return NextResponse.json(
        {
          error:
            'Falta configurar la app de Meta en el servidor (META_APP_ID y META_APP_SECRET).',
        },
        { status: 500 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as {
      code?: unknown
      waba_id?: unknown
      phone_number_id?: unknown
      verify_token?: unknown
    }

    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const wabaId = typeof body.waba_id === 'string' ? body.waba_id.trim() : ''
    const phoneNumberId =
      typeof body.phone_number_id === 'string' ? body.phone_number_id.trim() : ''
    const incomingVerifyToken =
      typeof body.verify_token === 'string' ? body.verify_token.trim() : ''

    if (!code || !wabaId || !phoneNumberId) {
      return NextResponse.json(
        {
          error:
            'Faltan datos del Embedded Signup (code, waba_id o phone_number_id).',
        },
        { status: 400 },
      )
    }

    // 1) Canjear el code por un business token (server-side).
    let accessToken: string
    try {
      accessToken = await exchangeCodeForBusinessToken({
        appId,
        appSecret,
        code,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido'
      console.error('[embedded-signup] code exchange failed:', message)
      return NextResponse.json(
        { error: `Meta rechazó el código de conexión: ${message}` },
        { status: 400 },
      )
    }

    // 2) Validar el número contra Meta antes de guardar.
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId,
        accessToken,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido'
      console.error('[embedded-signup] verify phone failed:', message)
      return NextResponse.json(
        { error: `No se pudo validar el número en Meta: ${message}` },
        { status: 400 },
      )
    }

    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // 3) Un número solo puede pertenecer a una cuenta (enrutado del webhook).
    const { data: claimed } = await supabaseAdmin
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phoneNumberId)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimed) {
      return NextResponse.json(
        {
          error:
            'Este número de WhatsApp ya está vinculado a otra cuenta de esta instancia.',
        },
        { status: 409 },
      )
    }

    // 4) Suscribir la WABA al webhook de esta app (idempotente).
    let subscribedAppsAt: string | null = null
    try {
      await subscribeWabaToApp({ wabaId, accessToken })
      subscribedAppsAt = new Date().toISOString()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[embedded-signup] subscribed_apps failed (non-fatal):', message)
    }

    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(accessToken)
      encryptedVerifyToken = incomingVerifyToken ? encrypt(incomingVerifyToken) : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido'
      console.error('[embedded-signup] encryption failed:', message)
      return NextResponse.json(
        { error: 'No se pudo cifrar el token. Revisa ENCRYPTION_KEY.' },
        { status: 500 },
      )
    }

    const now = new Date().toISOString()
    // Varias líneas por negocio (067): conectar un número que ya estaba
    // en este negocio lo actualiza; uno nuevo se AÑADE como otra línea
    // (antes pisaba la única). La primera nace como la de por defecto.
    const { data: accountLines } = await supabase
      .from('whatsapp_config')
      .select('id, phone_number_id')
      .eq('account_id', accountId)
    const lines = (accountLines ?? []) as { id: string; phone_number_id: string }[]
    const existing = lines.find((l) => l.phone_number_id === phoneNumberId) ?? null

    const baseRow = {
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      access_token: encryptedAccessToken,
      // Embedded Signup registra el número durante el flujo, así que
      // queda operativo para webhooks sin un /register aparte.
      registered_at: now,
      subscribed_apps_at: subscribedAppsAt,
      last_registration_error: null,
      status: 'connected',
    }
    if (encryptedVerifyToken) {
      Object.assign(baseRow, { verify_token: encryptedVerifyToken })
    }

    if (existing) {
      const { error } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('id', existing.id)
        .eq('account_id', accountId)
      if (error) {
        console.error('[embedded-signup] update failed:', error)
        return NextResponse.json(
          { error: 'No se pudo guardar la configuración' },
          { status: 500 },
        )
      }
    } else {
      const { error } = await supabase.from('whatsapp_config').insert({
        account_id: accountId,
        user_id: user.id,
        is_default: lines.length === 0,
        ...baseRow,
      })
      if (error) {
        console.error('[embedded-signup] insert failed:', error)
        return NextResponse.json(
          { error: 'No se pudo guardar la configuración' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({
      success: true,
      phone_info: phoneInfo,
      verify_token: incomingVerifyToken || null,
    })
  } catch (error) {
    console.error('Error in WhatsApp embedded-signup:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
