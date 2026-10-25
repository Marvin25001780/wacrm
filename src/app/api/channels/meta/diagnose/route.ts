import { NextResponse, type NextRequest } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  fetchPageProfile,
  fetchPageSubscriptions,
  subscribePageToApp,
} from '@/lib/channels/meta'

/**
 * GET /api/channels/meta/diagnose?channel=facebook|instagram
 *
 * Comprueba con la Graph API qué falta para que lleguen los mensajes:
 * token válido, página correcta, suscripción al webhook y campos
 * activos. Con `&fix=1` re-suscribe la página antes de informar.
 *
 * No modifica nada si no se pide `fix`.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const { searchParams } = new URL(request.url)
    const channel = searchParams.get('channel')
    const fix = searchParams.get('fix') === '1'

    if (channel !== 'instagram' && channel !== 'facebook') {
      return NextResponse.json(
        { error: 'Canal desconocido (se espera instagram o facebook)' },
        { status: 400 },
      )
    }

    const { data: row, error } = await ctx.supabase
      .from('channel_configs')
      .select('id, config, is_active')
      .eq('account_id', ctx.accountId)
      .eq('channel', channel)
      .maybeSingle()
    if (error) throw error

    const config = (row?.config ?? {}) as Record<string, unknown>
    const pageId = typeof config.page_id === 'string' ? config.page_id : ''

    let accessToken = ''
    let tokenError = ''
    try {
      accessToken =
        typeof config.access_token === 'string'
          ? decrypt(config.access_token)
          : ''
    } catch {
      tokenError = 'No se pudo descifrar el token guardado.'
    }

    const envAppId =
      process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || ''
    const envSecret = process.env.META_APP_SECRET || ''

    let storedSecretMatchesEnv: boolean | null = null
    if (typeof config.app_secret === 'string' && config.app_secret) {
      try {
        storedSecretMatchesEnv = envSecret
          ? decrypt(config.app_secret) === envSecret
          : null
      } catch {
        storedSecretMatchesEnv = false
      }
    }

    const base = {
      connected: Boolean(row?.is_active),
      channel,
      page_id: pageId || null,
      has_access_token: Boolean(accessToken),
      token_error: tokenError || null,
      has_verify_token:
        typeof config.verify_token === 'string' && Boolean(config.verify_token),
      has_app_secret: Boolean(config.app_secret),
      stored_secret_matches_env: storedSecretMatchesEnv,
      app_id: envAppId || null,
      webhook_url: row?.id
        ? `${new URL(request.url).origin}/api/webhooks/meta/${row.id}`
        : null,
      verify_token:
        typeof config.verify_token === 'string' ? config.verify_token : null,
    }

    if (!row?.is_active || !pageId || !accessToken) {
      return NextResponse.json({
        ...base,
        ok: false,
        problem:
          'El canal no está conectado o le faltan credenciales. Vuelve a conectarlo.',
      })
    }

    const profile = await fetchPageProfile(pageId, accessToken)
    if (!profile.ok) {
      return NextResponse.json({
        ...base,
        ok: false,
        problem: `Meta rechazó el token: ${profile.error}`,
      })
    }

    let subscribeError: string | null = null
    if (fix) {
      const sub = await subscribePageToApp(pageId, accessToken)
      if (!sub.ok) subscribeError = sub.error
    }

    const subs = await fetchPageSubscriptions(pageId, accessToken)

    const apps = subs.ok ? subs.data.apps : []
    const fields = [...new Set(apps.flatMap((app) => app.subscribedFields))]

    const problems: string[] = []
    if (!subs.ok) {
      problems.push(`No se pudo leer la suscripción: ${subs.error}`)
    } else if (apps.length === 0) {
      problems.push(
        'La página no tiene ninguna app suscrita: Meta no enviará eventos.',
      )
    } else if (!fields.includes('messages')) {
      problems.push('La suscripción no incluye el campo "messages".')
    }

    if (storedSecretMatchesEnv === false) {
      problems.push(
        'El App Secret guardado no coincide con META_APP_SECRET. Las firmas de Meta fallarán con 401.',
      )
    }
    if (!base.has_verify_token) {
      problems.push('Falta el Verify Token; Meta no puede verificar el webhook.')
    }

    return NextResponse.json({
      ...base,
      ok: problems.length === 0,
      page_name: profile.data.name,
      subscribed_apps: apps,
      subscribed_fields: fields,
      subscribe_error: subscribeError,
      problems,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
