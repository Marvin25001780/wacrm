import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  isMissingIntegrationsTable,
  loadExternalIntegrations,
} from '@/lib/integrations/external';
import {
  fetchListmonkLists,
  subscribeToFirstList,
  type ListmonkCredentials,
} from '@/lib/integrations/listmonk';

export const runtime = 'nodejs';

/** Tope por lote para no agotar el tiempo de la función. */
const MAX_CONTACTS = 200;
const CONCURRENCY = 4;

interface ContactRow {
  id: string;
  email: string | null;
  name: string | null;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function pump(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}

async function loadContacts(
  ctx: Awaited<ReturnType<typeof requireRole>>,
): Promise<{ contacts: ContactRow[]; total: number; truncated: boolean }> {
  const { data, error } = await ctx.supabase
    .from('contacts')
    .select('id, email, name')
    .eq('account_id', ctx.accountId)
    .not('email', 'is', null)
    .order('created_at', { ascending: false })
    .limit(MAX_CONTACTS + 1);

  if (error) throw error;

  const rows = (data ?? []) as ContactRow[];
  const seen = new Set<string>();
  const contacts: ContactRow[] = [];

  for (const row of rows) {
    const email = (row.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email) || seen.has(email)) continue;
    seen.add(email);
    contacts.push({ ...row, email });
    if (contacts.length >= MAX_CONTACTS) break;
  }

  return {
    contacts,
    total: contacts.length,
    truncated: rows.length > MAX_CONTACTS,
  };
}

/**
 * POST /api/integrations/external/listmonk/subscribe
 *
 * Suscribe a una lista de Listmonk los contactos del CRM que tengan
 * email. `dryRun` devuelve el conteo y una muestra; con `dryRun:false`
 * hace las llamadas reales. Idempotente: los que ya existen se agregan
 * a la lista sin duplicarse.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => ({}))) as {
      listId?: unknown;
      dryRun?: unknown;
    };

    const listId = Number(body.listId);
    if (!Number.isInteger(listId) || listId <= 0) {
      return bad('Elige una lista válida de Listmonk.');
    }

    const config = await loadExternalIntegrations(ctx.supabase, ctx.accountId);
    if (!config) return bad('Falta aplicar la migración 132 (integraciones externas).', 409);

    const { url, user, token, enabled } = config.listmonk;
    if (!enabled || !url || !user || !token) {
      return bad('Listmonk no está configurado o está desactivado.');
    }
    const credentials: ListmonkCredentials = { url, user, token };

    const lists = await fetchListmonkLists(credentials);
    if (!lists.ok) {
      return NextResponse.json(
        { error: lists.error ?? 'No se pudieron leer las listas de Listmonk.' },
        { status: 502 },
      );
    }
    const list = lists.data?.find((item) => item.id === listId);
    if (!list) return bad('La lista ya no existe en Listmonk.');

    const { contacts, total, truncated } = await loadContacts(ctx);

    if (body.dryRun !== false) {
      return NextResponse.json({
        dryRun: true,
        list,
        total,
        truncated,
        sample: contacts.slice(0, 10).map((contact) => ({
          email: contact.email,
          name: contact.name,
        })),
        note:
          total === 0
            ? 'No hay contactos con email en el CRM.'
            : 'Confirma para suscribir estos contactos a la lista.',
      });
    }

    if (total === 0) {
      return NextResponse.json({ list, total: 0, created: 0, added: 0, failed: 0, errors: [] });
    }

    const results = await runPool(contacts, CONCURRENCY, async (contact) => {
      const result = await subscribeToFirstList(credentials, {
        email: contact.email as string,
        name: contact.name,
        listId,
      });
      return { email: contact.email, result };
    });

    let created = 0;
    let added = 0;
    let failed = 0;
    const errors: Array<{ email: string | null; error: string }> = [];

    for (const item of results) {
      if (!item.result.ok) {
        failed += 1;
        if (errors.length < 5) {
          errors.push({
            email: item.email,
            error: item.result.error ?? `Listmonk respondió ${item.result.status ?? 'error'}`,
          });
        }
        continue;
      }
      if (item.result.data?.action === 'added') added += 1;
      else created += 1;
    }

    return NextResponse.json({ list, total, created, added, failed, errors });
  } catch (error) {
    if (isMissingIntegrationsTable(error as { code?: string } | null)) {
      return bad('Falta aplicar la migración 132 (integraciones externas).', 409);
    }
    return toErrorResponse(error);
  }
}
