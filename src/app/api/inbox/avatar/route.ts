import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { channelsAdmin } from '@/lib/channels/admin-client'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { syncContactAvatar } from '@/lib/avatar/sync'

// ============================================================
// POST /api/inbox/avatar  —  "Capturar foto de perfil"
//
// Botón manual de la Bandeja: vuelve a intentar traer la foto de
// perfil del contacto desde sus canales (Evolution/Baileys para
// WhatsApp, Graph API para Instagram/Facebook) y guardarla en
// `contacts.avatar_url`. Mismo motor que la captura automática de la
// ingesta, solo que a demanda del agente.
// ============================================================

export const maxDuration = 30

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

    const limit = checkRateLimit(`avatar:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const { contact_id } = (await request.json().catch(() => ({}))) as {
      contact_id?: string
    }
    if (!contact_id) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
    }

    // Carga la fila a través del cliente RLS del usuario → cualquier
    // agente de la cuenta puede pedir el sync, pero solo de contactos
    // que su cuenta puede ver.
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, account_id, avatar_url, phone')
      .eq('id', contact_id)
      .maybeSingle()

    if (contactError || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const admin = channelsAdmin()
    const result = await syncContactAvatar(admin, contact.account_id, contact)

    if (!result.updated) {
      return NextResponse.json(
        { updated: false, url: null, message: 'No se pudo obtener una foto para este contacto.' },
        { status: 200 },
      )
    }

    return NextResponse.json({ updated: true, url: result.url })
  } catch (err) {
    console.error('[inbox/avatar] sync error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}