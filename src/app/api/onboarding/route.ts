import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * PATCH /api/onboarding — guarda las respuestas del wizard de
 * bienvenida (068) y/o cierra el onboarding.
 *
 * Reparto:
 *   - `industry`, `role_title`, `avatar_url` → `profiles` del que
 *     llama. Lo cubre la policy de autoedición (auth.uid() = user_id);
 *     nunca toca account_id/account_role (los blinda el trigger de 066).
 *   - `account_name`, `website`, `lead_sources`, `team_size`, `goals`
 *     → `accounts` del negocio ACTIVO. Escribir ahí exige admin+:
 *     lo valida esta ruta (403 explícito) y lo re-valida RLS.
 *   - `completed: true` → sella `profiles.onboarding_completed_at`.
 *     Lo llama tanto el botón final como la X de "Saltar": cerrar el
 *     wizard es cerrarlo, con o sin respuestas.
 *
 * El wizard guarda por PASO (cada "Siguiente" = un PATCH), así que si
 * el usuario se va a conectar WhatsApp y vuelve, lo escrito está
 * a salvo y `GET` re-construye el estado.
 *
 * GET /api/onboarding — devuelve el estado completo para reanudar:
 * perfil (industria/cargo/avatar) + negocio (nombre, web, fuentes,
 * metas, tamaño) + si hay WhatsApp conectado (para el paso del canal).
 */
const ALLOWED_LEAD_SOURCES = new Set([
  'whatsapp',
  'instagram',
  'facebook',
  'tiktok',
  'sms',
  'web',
  'llamadas',
  'otras',
])
const ALLOWED_GOALS = new Set([
  'mensajes_segmentados',
  'oportunidades_venta',
  'seguimientos_auto',
  'leads_campanas',
  'reservas',
])
const ALLOWED_TEAM_SIZES = new Set([
  'solo_yo',
  '2_3',
  '4_5',
  '6_10',
  '11_20',
  '21_50',
  '51_100',
  '101_mas',
])

const clampText = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : null

const cleanList = (value: unknown, allowed: Set<string>): string[] =>
  Array.isArray(value)
    ? value.filter(
        (v): v is string => typeof v === 'string' && allowed.has(v),
      )
    : []

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Dos consultas planas, sin embed: el schema cache de PostgREST tras
  // una migración reciente ya mordió al perfil (#294).
  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'full_name, avatar_url, industry, role_title, onboarding_completed_at, account_id, account_role',
    )
    .eq('user_id', user.id)
    .maybeSingle()

  const accountId = (profile?.account_id as string | undefined) ?? null
  type AccountState = {
    name: string
    website: string | null
    lead_sources: string[]
    goals: string[]
    team_size: string | null
  }
  let account: AccountState | null = null
  if (accountId) {
    const { data: row } = await supabase
      .from('accounts')
      .select('name, website, lead_sources, goals, team_size')
      .eq('id', accountId)
      .maybeSingle()
    account = (row as AccountState | null) ?? null
    if (account) {
      account.lead_sources = account.lead_sources ?? []
      account.goals = account.goals ?? []
    }
  }

  return NextResponse.json({
    profile,
    account,
    // El paso 2 (conectar canal) se cierra solo ya: con una línea
    // conectada el wizard lo salta aunque esté pendiente por paso.
    whatsapp_connected: accountId
      ? (
          await supabase
            .from('whatsapp_config')
            .select('id')
            .eq('account_id', accountId)
            .limit(1)
        ).data?.length
        ? true
        : false
      : false,
  })
}

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

    const body = await request.json().catch(() => ({}))

    // ---- Perfil (la persona) ---------------------------------
    const profileUpdate: Record<string, unknown> = {}
    if ('industry' in body) profileUpdate.industry = clampText(body.industry, 60)
    if ('role_title' in body) profileUpdate.role_title = clampText(body.role_title, 60)
    if ('avatar_url' in body) {
      const url = clampText(body.avatar_url, 500)
      // Solo URLs http(s): el campo alimenta <img src="...">, y un
      // `javascript:` u otro esquema raro sería ejecutable en el DOM.
      if (url && !/^https:\/\//.test(url)) {
        return NextResponse.json(
          { error: 'avatar_url must be an https URL' },
          { status: 400 },
        )
      }
      profileUpdate.avatar_url = url
    }
    if (body.completed === true) {
      profileUpdate.onboarding_completed_at = new Date().toISOString()
    }

    if (Object.keys(profileUpdate).length > 0) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update(profileUpdate)
        .eq('user_id', user.id)
      if (profileError) {
        console.error('[onboarding] profile update failed:', profileError)
        return NextResponse.json(
          { error: 'No se pudo guardar tus respuestas' },
          { status: 500 },
        )
      }
    }

    // ---- Negocio (la empresa; solo admin+) -------------------
    const accountId =
      (await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle()).data?.account_id ?? null

    const accountUpdate: Record<string, unknown> = {}
    if ('account_name' in body && typeof body.account_name === 'string' && body.account_name.trim()) {
      const name = body.account_name.trim().slice(0, 80)
      if (name.length < 2) {
        return NextResponse.json(
          { error: 'El nombre debe tener al menos 2 caracteres' },
          { status: 400 },
        )
      }
      accountUpdate.name = name
    }
    if ('website' in body) accountUpdate.website = clampText(body.website, 200)
    if ('lead_sources' in body) accountUpdate.lead_sources = cleanList(body.lead_sources, ALLOWED_LEAD_SOURCES)
    if ('goals' in body) {
      const goals = cleanList(body.goals, ALLOWED_GOALS)
      // "Elige hasta 2": se respetó en la UI; se re-fuerza aquí.
      accountUpdate.goals = goals.slice(0, 2)
    }
    if ('team_size' in body) {
      const size = clampText(body.team_size, 10)
      if (size && !ALLOWED_TEAM_SIZES.has(size)) {
        return NextResponse.json(
          { error: `team_size inválido: ${size}` },
          { status: 400 },
        )
      }
      accountUpdate.team_size = size
    }

    if (Object.keys(accountUpdate).length > 0) {
      if (!accountId) {
        return NextResponse.json(
          { error: 'Your profile is not linked to an account.' },
          { status: 403 },
        )
      }
      const { data: role } = await supabase
        .from('profiles')
        .select('account_role')
        .eq('user_id', user.id)
        .maybeSingle()
      const rr = (role?.account_role as string | undefined) ?? 'viewer'
      if (!['owner', 'admin'].includes(rr)) {
        return NextResponse.json(
          { error: 'Solo un admin puede editar los datos del negocio' },
          { status: 403 },
        )
      }

      const { error: accountError } = await supabase
        .from('accounts')
        .update({ ...accountUpdate, updated_at: new Date().toISOString() })
        .eq('id', accountId)
      if (accountError) {
        console.error('[onboarding] account update failed:', accountError)
        return NextResponse.json(
          { error: 'No se pudo guardar los datos del negocio' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[onboarding] unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
