import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import type { WebchatPosition } from '@/types';

// ============================================================
// /api/webchat/config  —  módulo 2.6 (migration 039)
//
// GET    — cualquier miembro lee la config del widget de su cuenta.
// POST   — admin+ crea/actualiza (upsert, una fila por cuenta).
// DELETE — admin+ elimina la config.
//
// El `token` público se mantiene estable salvo que se pida
// `regenerate_token: true` (p. ej. tras filtrarse la URL).
// ============================================================

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const POSITIONS: WebchatPosition[] = ['bottom-right', 'bottom-left'];

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('webchat_configs')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      console.error('[webchat/config GET] error:', error);
      return NextResponse.json(
        { error: 'No se pudo cargar la configuración.' },
        { status: 500 },
      );
    }
    if (!data) return NextResponse.json({ configured: false });
    return NextResponse.json({ configured: true, config: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`webchat-config:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Cuerpo inválido.');

    const b = body as Record<string, unknown>;

    const title =
      typeof b.title === 'string' && b.title.trim()
        ? b.title.trim().slice(0, 80)
        : 'Chatea con nosotros';
    const welcome =
      typeof b.welcome_message === 'string' && b.welcome_message.trim()
        ? b.welcome_message.trim().slice(0, 500)
        : null;
    const color =
      typeof b.color === 'string' && HEX_RE.test(b.color.trim())
        ? b.color.trim()
        : '#2563eb';
    const buttonText =
      typeof b.button_text === 'string' && b.button_text.trim()
        ? b.button_text.trim().slice(0, 40)
        : 'Enviar';
    const position: WebchatPosition = POSITIONS.includes(b.position as WebchatPosition)
      ? (b.position as WebchatPosition)
      : 'bottom-right';
    const enabled = b.enabled === true;
    const regenerate = b.regenerate_token === true;

    const { data: existing } = await supabase
      .from('webchat_configs')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle();

    const shared = {
      enabled,
      title,
      welcome_message: welcome,
      color,
      button_text: buttonText,
      position,
    };

    if (existing) {
      const patch: Record<string, unknown> = { ...shared };
      if (regenerate) patch.token = crypto.randomUUID();
      const { error } = await supabase
        .from('webchat_configs')
        .update(patch)
        .eq('account_id', accountId);
      if (error) {
        console.error('[webchat/config POST] update error:', error);
        return NextResponse.json(
          { error: 'No se pudo guardar.' },
          { status: 500 },
        );
      }
    } else {
      const { error } = await supabase.from('webchat_configs').insert({
        account_id: accountId,
        created_by: userId,
        ...shared,
      });
      if (error) {
        console.error('[webchat/config POST] insert error:', error);
        return NextResponse.json(
          { error: 'No se pudo guardar.' },
          { status: 500 },
        );
      }
    }

    const { data } = await supabase
      .from('webchat_configs')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    return NextResponse.json({ success: true, config: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { error } = await supabase
      .from('webchat_configs')
      .delete()
      .eq('account_id', accountId);
    if (error) {
      console.error('[webchat/config DELETE] error:', error);
      return NextResponse.json(
        { error: 'No se pudo eliminar.' },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
