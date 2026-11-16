import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseTimeToMinutes } from '@/lib/telephony/adherence';

/** Tope de turnos por agente (una semana tiene 7 días; deja margen). */
const MAX_SHIFTS_PER_AGENT = 21;

/**
 * GET  /api/telephony/shifts — turnos semanales del negocio (admin+).
 * POST /api/telephony/shifts — crea un turno.
 *
 * Body: { userId, weekday (0 = domingo … 6 = sábado), startTime
 * ("HH:MM"), endTime ("HH:MM"), label? }. La hora es local de
 * Venezuela; un turno cuyo fin es menor que el inicio cruza
 * medianoche.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const { data, error } = await ctx.supabase
      .from('agent_shifts')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('weekday', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      if (isMissingRelation(error)) {
        return NextResponse.json({ shifts: [], migrationMissing: true });
      }
      throw error;
    }

    return NextResponse.json({ shifts: data ?? [], migrationMissing: false });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo inválido.' }, { status: 400 });
    }

    const userId = typeof body.userId === 'string' ? body.userId : '';
    if (!userId) {
      return NextResponse.json(
        { error: 'Falta el agente del turno.' },
        { status: 400 }
      );
    }

    const weekday = Math.floor(Number(body.weekday));
    if (!Number.isFinite(weekday) || weekday < 0 || weekday > 6) {
      return NextResponse.json(
        { error: 'El día debe ser de domingo (0) a sábado (6).' },
        { status: 400 }
      );
    }

    const startMinutes = parseTimeToMinutes(String(body.startTime ?? ''));
    const endMinutes = parseTimeToMinutes(String(body.endTime ?? ''));
    if (startMinutes === null || endMinutes === null) {
      return NextResponse.json(
        { error: 'Las horas deben tener formato HH:MM.' },
        { status: 400 }
      );
    }
    if (startMinutes === endMinutes) {
      return NextResponse.json(
        { error: 'El turno no puede empezar y terminar a la misma hora.' },
        { status: 400 }
      );
    }

    const rawLabel = body.label;
    if (rawLabel !== undefined && rawLabel !== null && typeof rawLabel !== 'string') {
      return NextResponse.json(
        { error: 'La etiqueta del turno debe ser texto.' },
        { status: 400 }
      );
    }
    const label = typeof rawLabel === 'string' ? rawLabel.trim().slice(0, 60) : '';

    // El agente debe pertenecer al negocio.
    const { data: member, error: memberError } = await ctx.supabase
      .from('account_members')
      .select('user_id')
      .eq('account_id', ctx.accountId)
      .eq('user_id', userId)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) {
      return NextResponse.json(
        { error: 'Ese usuario no pertenece al negocio.' },
        { status: 400 }
      );
    }

    const { count, error: countError } = await ctx.supabase
      .from('agent_shifts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .eq('user_id', userId);
    if (countError) {
      if (isMissingRelation(countError)) {
        return migrationMissingResponse();
      }
      throw countError;
    }
    if ((count ?? 0) >= MAX_SHIFTS_PER_AGENT) {
      return NextResponse.json(
        {
          error: `Máximo ${MAX_SHIFTS_PER_AGENT} turnos por agente. Borra alguno antes de añadir otro.`,
        },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('agent_shifts')
      .insert({
        account_id: ctx.accountId,
        user_id: userId,
        weekday,
        start_time: minutesToTime(startMinutes),
        end_time: minutesToTime(endMinutes),
        label: label || null,
        created_by: ctx.userId,
      })
      .select('*')
      .single();

    if (error) {
      if (isMissingRelation(error)) return migrationMissingResponse();
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Ese turno ya existe para el agente.' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: true, shift: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}:00`;
}

function isMissingRelation(error: { code?: string }): boolean {
  return error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703';
}

function migrationMissingResponse() {
  return NextResponse.json(
    { error: 'Falta aplicar la migración 120_wem_adherence.sql.' },
    { status: 400 }
  );
}
