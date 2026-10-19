import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsappConfig } from '@/lib/whatsapp/config'

/**
 * Resolve the caller's account_id from their profile. Inlined here
 * (rather than going through `@/lib/auth/account.getCurrentAccount`)
 * because the GET handler wants to return shaped 200s for every
 * non-auth failure mode, not throw — keeping the helper minimal lets
 * the existing response branches stay as-is.
 *
 * Returns null if the user has no profile or no account; callers
 * should treat that the same as "not connected".
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

// Lazy-initialised service-role client. We need it to detect a
// phone_number_id already claimed by a *different* user — under RLS,
// the user's own session can't see other users' rows, so the conflict
// would be invisible without the service role.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...} }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...' }
 *
 * `?lazy=1` responde sin llamar a Meta (solo comprueba que exista la
 * fila). Lo usa la página de Canales para pintar el badge sin coste de
 * red; la verificación real se hace al abrir el diálogo.
 */
export async function GET(request: Request) {
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
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 },
      )
    }

    const params = new URL(request.url).searchParams

    // `?list=1`: todas las líneas del negocio (067), SIN tokens. Es lo
    // que pinta la lista de números en Ajustes.
    if (params.get('list') === '1') {
      const { data: lines, error: listError } = await supabase
        .from('whatsapp_config')
        .select(
          'id, label, phone_number_id, waba_id, status, is_default, registered_at, last_registration_error, created_at',
        )
        .eq('account_id', accountId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })
      if (listError) {
        console.error('Error listing whatsapp_config:', listError)
        return NextResponse.json(
          { error: 'Failed to list WhatsApp numbers' },
          { status: 500 },
        )
      }
      return NextResponse.json({ lines: lines ?? [] })
    }

    // `?config_id=` verifica una línea concreta; sin él, la por defecto.
    const { data: config, error: configError } = await resolveWhatsappConfig(
      supabase,
      accountId,
      params.get('config_id'),
    )

    if (configError) {
      console.error('Error fetching whatsapp_config:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    // Camino ligero: la página de Canales solo quiere saber si hay una
    // configuración guardada, sin pagar una llamada a Meta por carga.
    if (params.get('lazy') === '1') {
      return NextResponse.json(
        {
          connected: config.status !== 'disconnected',
          phone_number_id: config.phone_number_id,
          config_id: config.id,
        },
        { status: 200 },
      )
    }

    // Try to decrypt the stored token with the current ENCRYPTION_KEY.
    // If this fails, the key changed (or was never consistent across envs).
    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      )
    }

    // Validate credentials against Meta
    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
      return NextResponse.json({ connected: true, phone_info: phoneInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[whatsapp/config GET] Meta API verification failed:', message)
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: `Meta API rejected the credentials: ${message}`,
        },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Verifies credentials with Meta first, then encrypts and stores.
 */
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
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const { phone_number_id, waba_id, access_token, verify_token, pin } = body
    // 067 — varias líneas por negocio:
    //   config_id   → editar esa línea concreta
    //   mode: 'add' → conectar una línea NUEVA
    //   (ninguno)   → la línea por defecto (lo que hacía la pantalla
    //                 de una sola línea: guardar = reemplazar)
    const configId =
      typeof body.config_id === 'string' && body.config_id ? body.config_id : null
    const addMode = body.mode === 'add'
    const label =
      typeof body.label === 'string' && body.label.trim()
        ? body.label.trim().slice(0, 60)
        : undefined

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      )
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be exactly 6 digits.' },
          { status: 400 }
        )
      }
    }

    // Reject if another account has already claimed this phone_number_id.
    // wacrm is single-tenant-per-WhatsApp-number — letting two accounts
    // bind the same number causes the webhook's `.single()` lookup to
    // throw PGRST116 ("multiple rows"), silently dropping every
    // inbound message. See issue #136. Post-multi-user we key on
    // account_id (not user_id) since teammates inside the same account
    // all share one config; the conflict is between accounts.
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phone_number_id)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimedError) {
      console.error('Error checking phone_number_id ownership:', claimedError)
      return NextResponse.json(
        { error: 'Failed to validate configuration' },
        { status: 500 }
      )
    }

    if (claimed) {
      return NextResponse.json(
        {
          error:
            'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
        },
        { status: 409 }
      )
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API verification failed during save:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      )
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(access_token)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      )
    }

    // Which row (if any) this save targets. Also tells us whether this
    // number is already registered with Meta — if so we can skip
    // /register when the user didn't provide a PIN this time around.
    const { data: accountLines, error: linesError } = await supabase
      .from('whatsapp_config')
      .select('id, registered_at, phone_number_id, is_default')
      .eq('account_id', accountId)
    if (linesError) {
      console.error('Error loading whatsapp_config lines:', linesError)
      return NextResponse.json(
        { error: 'Failed to load configuration' },
        { status: 500 },
      )
    }
    type LineRow = {
      id: string
      registered_at: string | null
      phone_number_id: string
      is_default: boolean
    }
    const lines = (accountLines ?? []) as LineRow[]
    // El mismo número ya conectado en este negocio siempre se edita (no
    // se duplica: `phone_number_id` es único en toda la instancia).
    const samePhoneLine = lines.find((l) => l.phone_number_id === phone_number_id)
    let existing: LineRow | null
    if (configId) {
      existing = lines.find((l) => l.id === configId) ?? null
      if (!existing) {
        return NextResponse.json(
          { error: 'WhatsApp number not found in this business.' },
          { status: 404 },
        )
      }
      if (samePhoneLine && samePhoneLine.id !== existing.id) {
        return NextResponse.json(
          { error: 'That phone number is already connected as another line.' },
          { status: 409 },
        )
      }
    } else if (samePhoneLine) {
      existing = samePhoneLine
    } else if (addMode) {
      existing = null
    } else {
      existing = lines.find((l) => l.is_default) ?? lines[0] ?? null
    }

    const sameNumber =
      existing?.phone_number_id === phone_number_id &&
      existing?.registered_at != null

    // Step 1: register the phone number for inbound webhooks.
    //
    // Attempted on first save AND whenever the user supplies a fresh
    // PIN (e.g. they rotated the 2FA PIN in Meta Manager). Skipped
    // when the same number is already registered and no PIN was
    // supplied — re-registering an already-active number with a
    // stale PIN would actually fail and undo the active subscription.
    let registeredAt: string | null = existing?.registered_at ?? null
    let registrationError: string | null = null
    // True when registration was deliberately skipped because no PIN
    // was supplied (see below). Distinct from registrationError — this
    // is not a failure, just an incomplete-but-valid save.
    let registrationSkipped = false

    const needsRegistration = !sameNumber || (typeof pin === 'string' && pin.length > 0)
    if (needsRegistration) {
      if (!pin) {
        // No PIN provided. Meta TEST numbers (Developer Console) are
        // pre-registered by Meta and expose no two-step verification
        // PIN to set, so requiring one made them impossible to connect
        // (issue #242). The /register + PIN step only matters for
        // production numbers under a shared WABA (issue #136), so treat
        // it as best-effort: skip it, save the (already Meta-verified)
        // credentials as connected, and leave registered_at null. The
        // UI surfaces a separate "Not registered" banner with a path to
        // add a PIN later for users who do need inbound webhook routing.
        registrationSkipped = true
      } else {
        try {
          await registerPhoneNumber({
            phoneNumberId: phone_number_id,
            accessToken: access_token,
            pin,
          })
          registeredAt = new Date().toISOString()
        } catch (err) {
          registrationError =
            err instanceof Error ? err.message : 'Unknown Meta API error'
          console.error('Phone number /register failed:', registrationError)
          // We deliberately fall through and still save the row so the
          // user can retry without re-entering everything. The UI
          // surfaces `last_registration_error` so they see WHY it's
          // not actually live yet.
        }
      }
    }

    // Step 2: subscribe the WABA to this app. Idempotent on Meta's
    // side, so we call on every save and persist the timestamp.
    // Skipped only when there's no waba_id (legacy rows from before
    // we required it).
    let subscribedAppsAt: string | null = null
    if (waba_id) {
      try {
        await subscribeWabaToApp({
          wabaId: waba_id,
          accessToken: access_token,
        })
        subscribedAppsAt = new Date().toISOString()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('WABA subscribed_apps failed (non-fatal):', message)
        // Subscription failures are rare once the App has the right
        // permissions; we don't block save on them — the diagnostic
        // endpoint surfaces this state too.
      }
    }

    // Persist everything in one shot. If /register failed we still
    // store the credentials and the error so the UI can guide the
    // user through a retry.
    const baseRow = {
      phone_number_id,
      waba_id: waba_id || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(label !== undefined ? { ...baseRow, label } : baseRow)
        .eq('id', existing.id)
        .eq('account_id', accountId)

      if (updateError) {
        console.error('Error updating whatsapp_config:', updateError)
        return NextResponse.json(
          { error: 'Failed to update configuration' },
          { status: 500 }
        )
      }
    } else {
      // Insert with both columns: `account_id` is the tenancy key,
      // `user_id` is the audit column identifying which member of the
      // account saved the config. La primera línea del negocio nace
      // como la de por defecto; las siguientes no (se cambia en Ajustes).
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          label: label ?? null,
          is_default: lines.length === 0,
          ...baseRow,
        })

      if (insertError) {
        console.error('Error inserting whatsapp_config:', insertError)
        return NextResponse.json(
          { error: 'Failed to save configuration' },
          { status: 500 }
        )
      }
    }

    if (registrationError) {
      // Save succeeded but the number isn't actually live. Return
      // 200 with a structured error so the UI can show the specific
      // remediation step instead of a generic toast.
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        phone_info: phoneInfo,
      })
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: registeredAt != null,
      // Credentials are valid and saved, but inbound webhook
      // registration was skipped because no PIN was supplied (e.g. a
      // Meta test number). The UI shows the "Not registered" banner
      // rather than claiming the number is fully live.
      registration_skipped: registrationSkipped,
      phone_info: phoneInfo,
    })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/whatsapp/config  { config_id, label?, is_default? }
 *
 * Renombra una línea o la marca como la de por defecto del negocio
 * (067). Desmarcar la anterior lo hace el trigger
 * `whatsapp_config_single_default` en la misma sentencia. Solo admin+:
 * lo impone la política `whatsapp_config_update` (RLS), no esta ruta.
 */
export async function PATCH(request: Request) {
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
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const configId = typeof body.config_id === 'string' ? body.config_id : ''
    if (!configId) {
      return NextResponse.json({ error: 'config_id is required' }, { status: 400 })
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.label === 'string') {
      const trimmed = body.label.trim()
      update.label = trimmed ? trimmed.slice(0, 60) : null
    }
    // Solo se puede MARCAR como por defecto: quitar la marca dejaría al
    // negocio sin línea por defecto. Se cambia marcando otra.
    if (body.is_default === true) update.is_default = true

    if (Object.keys(update).length === 1) {
      return NextResponse.json(
        { error: 'Nothing to update (label or is_default: true)' },
        { status: 400 },
      )
    }

    const { data: updated, error: updateError } = await supabase
      .from('whatsapp_config')
      .update(update)
      .eq('id', configId)
      .eq('account_id', accountId)
      .select('id')

    if (updateError) {
      console.error('Error updating whatsapp_config line:', updateError)
      return NextResponse.json(
        { error: 'Failed to update WhatsApp number' },
        { status: 500 },
      )
    }
    // 0 filas = no existe en este negocio o RLS lo impidió (no admin).
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: 'WhatsApp number not found, or you need the admin role.' },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config[?config_id=]
 *
 * Removes one WhatsApp line: the one in `config_id`, or the default
 * line when omitted (the single-line "Reset Configuration" button,
 * used to recover from a corrupted encrypted token). If the removed
 * line was the default, the oldest remaining one is promoted so the
 * business never ends up with lines but no default.
 */
export async function DELETE(request: Request) {
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
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { data: target } = await resolveWhatsappConfig(
      supabase,
      accountId,
      new URL(request.url).searchParams.get('config_id'),
    )
    if (!target) {
      return NextResponse.json({ success: true, deleted: 0 })
    }

    const { data: deleted, error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('id', target.id)
      .eq('account_id', accountId)
      .select('id')

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      )
    }

    // Si era la de por defecto y quedan otras, se asciende la más
    // antigua. Los hilos de la línea borrada quedan con
    // `whatsapp_config_id` NULL (FK SET NULL) y responden por la nueva
    // por defecto.
    if (target.is_default && deleted && deleted.length > 0) {
      const { data: rest } = await supabase
        .from('whatsapp_config')
        .select('id')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (rest && rest[0]) {
        const { error: promoteError } = await supabase
          .from('whatsapp_config')
          .update({ is_default: true })
          .eq('id', rest[0].id)
        if (promoteError) {
          console.error('Error promoting new default line:', promoteError)
        }
      }
    }

    return NextResponse.json({ success: true, deleted: deleted?.length ?? 0 })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
