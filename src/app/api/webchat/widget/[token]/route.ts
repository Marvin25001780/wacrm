import { NextResponse } from 'next/server';
import { webchatAdmin } from '@/lib/webchat/admin-client';
import type { WebchatPublicConfig } from '@/types';

// ============================================================
// GET /api/webchat/widget/[token]  —  config pública del widget
//
// Público (sin sesión): el widget embebido en un sitio externo lee
// aquí su título/color/mensaje. Solo devuelve campos no sensibles y
// únicamente si el widget está habilitado.
// ============================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const admin = webchatAdmin();
  const { data, error } = await admin
    .from('webchat_configs')
    .select('enabled, title, welcome_message, color, button_text, position')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    console.error('[webchat/widget GET] error:', error);
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }
  if (!data || !data.enabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const config: WebchatPublicConfig = {
    title: data.title,
    welcome_message: data.welcome_message,
    color: data.color,
    button_text: data.button_text,
    position: data.position,
    enabled: true,
  };
  return NextResponse.json(config);
}
