import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { normalizePhone } from '@/lib/telephony/phone';
import { loadTelephonyRoster } from '@/lib/telephony/roster';
import type { CallbackRequest } from '@/types';

const LIST_LIMIT = 200;

/**
 * GET  /api/telephony/callbacks — devoluciones del negocio (agente+).
 * POST /api/telephony/callbacks — alta manual.
 *
 * Body POST: { phone: string, note?: string, contactId?: string }.
 * El número se normaliza a E.164 y, si no se indica contacto, se
 * busca por `phone_normalized`.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const validStatus =
      status === 'pending' ||
      status === 'in_progress' ||
      status === 'done' ||
      status === 'cancelled'
        ? status
        : null;

    let query = ctx.supabase
      .from('callback_requests')
      .select('*, contact:contacts(id, name, phone)')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
      .limit(LIST_LIMIT);

    if (validStatus) query = query.eq('status', validStatus);

    const { data, error } = await query;
    if (error) {
      if (isMissingRelation(error)) {
        return NextResponse.json({
          callbacks: [],
          migrationMissing: true,
        });
      }
      throw error;
    }

    const roster = await loadTelephonyRoster(ctx.supabase, ctx.accountId);
    const names = new Map(
      (roster ?? []).map((member) => [member.user_id, member.name])
    );

    const callbacks = ((data ?? []) as CallbackRequest[]).map((row) => ({
      ...row,
      assigned_name: row.assigned_user_id
        ? (names.get(row.assigned_user_id) ?? null)
        : null,
    }));

    return NextResponse.json({ callbacks, migrationMissing: false });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo inválido.' }, { status: 400 });
    }

    const phone = normalizePhone(body.phone);
    if (!phone) {
      return NextResponse.json(
        { error: 'Número inválido. Usa formato local (0412…) o +58….' },
        { status: 400 }
      );
    }

    const rawNote = body.note;
    if (rawNote !== undefined && rawNote !== null && typeof rawNote !== 'string') {
      return NextResponse.json(
        { error: 'La nota debe ser texto.' },
        { status: 400 }
      );
    }
    const note =
      typeof rawNote === 'string' ? rawNote.trim().slice(0, 500) : '';

    const db: SupabaseClient = ctx.supabase;
    let contactId: string | null = null;

    if (typeof body.contactId === 'string' && body.contactId) {
      const { data, error } = await db
        .from('contacts')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('id', body.contactId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return NextResponse.json(
          { error: 'El contacto no pertenece a este negocio.' },
          { status: 400 }
        );
      }
      contactId = data.id as string;
    } else {
      const digits = phone.replace(/\D/g, '');
      const { data } = await db
        .from('contacts')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('phone_normalized', digits)
        .maybeSingle();
      contactId = (data?.id as string | undefined) ?? null;
    }

    const { data, error } = await db
      .from('callback_requests')
      .insert({
        account_id: ctx.accountId,
        phone,
        contact_id: contactId,
        reason: 'manual',
        note: note || null,
        status: 'pending',
        created_by: ctx.userId,
      })
      .select('*, contact:contacts(id, name, phone)')
      .single();

    if (error) {
      if (isMissingRelation(error)) return migrationMissingResponse();
      throw error;
    }

    return NextResponse.json({ ok: true, callback: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function isMissingRelation(error: { code?: string }): boolean {
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === '42703'
  );
}

function migrationMissingResponse() {
  return NextResponse.json(
    {
      error:
        'Falta aplicar la migración 122_callback_requests.sql (devoluciones de llamadas).',
    },
    { status: 400 }
  );
}
