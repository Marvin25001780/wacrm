import { NextResponse } from 'next/server';
import { webchatAdmin } from '@/lib/webchat/admin-client';
import { validateWebchatSubmission } from '@/lib/webchat/validation';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

// ============================================================
// POST /api/webchat/widget/[token]/submit  —  captura pública
//
// Crea un Lead (source='webchat') a nombre de la cuenta dueña del
// widget. Público y sin sesión → usa el cliente service-role y un
// límite por IP. El autor (`leads.user_id`, NOT NULL) es quien creó
// el widget; si esa cuenta de usuario ya no existe, cae al dueño.
// ============================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const limit = checkRateLimit(
    `webchat-submit:${clientIp(request)}`,
    { limit: 10, windowMs: 60_000 },
  );
  if (!limit.success) return rateLimitResponse(limit);

  const raw = await request.json().catch(() => null);
  const parsed = validateWebchatSubmission(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const admin = webchatAdmin();

  const { data: cfg, error: cfgErr } = await admin
    .from('webchat_configs')
    .select('account_id, created_by, enabled')
    .eq('token', token)
    .maybeSingle();

  if (cfgErr) {
    console.error('[webchat/submit] config error:', cfgErr);
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }
  if (!cfg || !cfg.enabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // `leads.user_id` es NOT NULL. Preferimos al creador del widget;
  // si se borró, usamos al dueño de la cuenta.
  let authorId: string | null = cfg.created_by ?? null;
  if (!authorId) {
    const { data: owner } = await admin
      .from('profiles')
      .select('user_id')
      .eq('account_id', cfg.account_id)
      .order('account_role', { ascending: true })
      .limit(1)
      .maybeSingle();
    authorId = owner?.user_id ?? null;
  }
  if (!authorId) {
    console.error('[webchat/submit] no author for account', cfg.account_id);
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }

  const { name, phone, email, message } = parsed.value;

  const { error: insErr } = await admin.from('leads').insert({
    account_id: cfg.account_id,
    user_id: authorId,
    name,
    phone,
    email,
    notes: message,
    source: 'webchat',
    status: 'new',
    value: 0,
    currency: 'USD',
  });

  if (insErr) {
    console.error('[webchat/submit] insert error:', insErr);
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
