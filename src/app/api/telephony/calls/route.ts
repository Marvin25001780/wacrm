import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import {
  loadTelephonyConfig,
  resolveTelephony,
  telephonyBlockReason,
} from '@/lib/telephony/config';
import { newCallRoomName } from '@/lib/telephony/calls';
import { finalizeCall } from '@/lib/telephony/finalize';
import {
  historyFromIso,
  historySearchTerms,
  isPhoneOnlySearch,
  parseHistoryFilters,
} from '@/lib/telephony/history';
import { telephonyErrorResponse } from '@/lib/telephony/http';
import { createAgentToken, dialPstn } from '@/lib/telephony/livekit';
import { normalizePhone } from '@/lib/telephony/phone';
import { loadTelephonyRoster } from '@/lib/telephony/roster';
import { setAgentStatusRpc } from '@/lib/telephony/status';
import type { CallSession } from '@/types';

/**
 * GET  /api/telephony/calls — historial con filtros y paginación.
 * POST /api/telephony/calls — inicia una llamada saliente a la PSTN.
 *
 * GET admite:
 *   q           texto: número (últimos 7 dígitos) o nombre del contacto
 *   direction   inbound | outbound
 *   status      ringing | active | ended | missed | failed | cancelled
 *   disposition sale | quote | support | …
 *   agent       user_id del agente
 *   days        7 | 30 | 90 | 0 (0 = todo)
 *   limit       25 | 50 | 100
 *   offset      desde 0
 *   contactId   llamadas de un contacto (lo usa la ficha del contacto)
 *
 * Devuelve `{ calls, limit, offset, hasMore }`; cada fila trae
 * `agent_name` resuelto con el roster del negocio. Los filtros
 * inválidos caen al valor por defecto en vez de romper la pantalla.
 *
 * Body POST: { to, contactId?, conversationId?, leadId?, tabId?, campaignContactId? }
 * Devuelve la sesión + el token de LiveKit para que el navegador
 * entre a la sala. Si el marcado SIP falla, la sesión queda como
 * `failed` (auditoría) y la API responde 502 con el motivo.
 *
 * `campaignContactId` vincula la llamada saliente con un contacto de
 * una campaña (migración 117); al cerrarla, el contacto pasa a
 * `called`.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const url = new URL(request.url);
    const filters = parseHistoryFilters(url.searchParams);
    const contactId = url.searchParams.get('contactId');

    let query = ctx.supabase
      .from('call_sessions')
      .select('*, contact:contacts(id, name, phone)')
      .eq('account_id', ctx.accountId);

    const from = historyFromIso(filters.days);
    if (from) query = query.gte('started_at', from);
    if (contactId) query = query.eq('contact_id', contactId);
    if (filters.direction) query = query.eq('direction', filters.direction);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.disposition) query = query.eq('disposition', filters.disposition);
    if (filters.agent) query = query.eq('agent_user_id', filters.agent);

    if (filters.q) {
      const { phoneKey, text } = historySearchTerms(filters.q);
      const orParts: string[] = [];
      if (phoneKey) {
        orParts.push(
          `from_number.ilike.%${phoneKey}%`,
          `to_number.ilike.%${phoneKey}%`
        );
      }

      if (text && !isPhoneOnlySearch(text)) {
        // El nombre vive en `contacts`; se resuelven primero sus ids
        // (tope de 200) y luego se filtran las llamadas por contacto.
        const { data: contacts, error: contactsError } = await ctx.supabase
          .from('contacts')
          .select('id')
          .eq('account_id', ctx.accountId)
          .ilike('name', `%${text}%`)
          .limit(200);
        if (contactsError) throw contactsError;
        const ids = (contacts ?? [])
          .map((row) => row.id as string)
          .filter(Boolean);
        if (ids.length > 0) {
          orParts.push(`contact_id.in.(${ids.join(',')})`);
        }
      }

      // Sin número reconocible ni contactos, no hay nada que buscar:
      // se responde vacío en vez de traer el historial entero.
      if (orParts.length === 0) {
        return NextResponse.json({
          calls: [],
          limit: filters.limit,
          offset: filters.offset,
          hasMore: false,
        });
      }
      query = query.or(orParts.join(','));
    }

    // Una fila de más para saber si hay página siguiente sin un count.
    const { data, error } = await query
      .order('started_at', { ascending: false })
      .range(filters.offset, filters.offset + filters.limit);
    if (error) throw error;

    const rows = (data ?? []) as Array<CallSession & { agent_name?: string | null }>;
    const hasMore = rows.length > filters.limit;
    const visible = hasMore ? rows.slice(0, filters.limit) : rows;

    if (visible.some((row) => row.agent_user_id)) {
      const roster =
        (await loadTelephonyRoster(ctx.supabase, ctx.accountId)) ?? [];
      const names = new Map(roster.map((member) => [member.user_id, member.name]));
      for (const row of visible) {
        row.agent_name = row.agent_user_id
          ? names.get(row.agent_user_id) ?? 'Agente'
          : null;
      }
    }

    return NextResponse.json({
      calls: visible,
      limit: filters.limit,
      offset: filters.offset,
      hasMore,
    });
  } catch (err) {
    return telephonyErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => ({}))) as {
      to?: unknown;
      contactId?: unknown;
      conversationId?: unknown;
      leadId?: unknown;
      tabId?: unknown;
      campaignContactId?: unknown;
    };

    const to = normalizePhone(body.to);
    if (!to) {
      return NextResponse.json(
        {
          error:
            'El número no es válido. Escríbelo en formato local (0412…) o +58….',
        },
        { status: 400 }
      );
    }

    const loaded = await loadTelephonyConfig(ctx.supabase, ctx.accountId);
    const resolved = resolveTelephony(loaded);
    const block = telephonyBlockReason(resolved);
    if (block) {
      return NextResponse.json({ error: block }, { status: 400 });
    }

    // Contacto: el indicado o, si no, el que tenga ese teléfono.
    let contactId = typeof body.contactId === 'string' ? body.contactId : null;
    let contactName: string | null = null;
    if (contactId) {
      const { data } = await ctx.supabase
        .from('contacts')
        .select('id, name, account_id')
        .eq('id', contactId)
        .maybeSingle();
      if (!data || data.account_id !== ctx.accountId) {
        return NextResponse.json(
          { error: 'El contacto no pertenece a este negocio.' },
          { status: 400 }
        );
      }
      contactName = (data.name as string | null) ?? null;
    } else {
      const digits = to.replace(/\D/g, '');
      const { data } = await ctx.supabase
        .from('contacts')
        .select('id, name')
        .eq('account_id', ctx.accountId)
        .eq('phone_normalized', digits)
        .maybeSingle();
      if (data) {
        contactId = data.id as string;
        contactName = (data.name as string | null) ?? null;
      }
    }

    const room = newCallRoomName();
    const token = await createAgentToken({
      room,
      identity: `user-${ctx.userId}`,
      name: ctx.account.name,
      metadata: { account_id: ctx.accountId, user_id: ctx.userId },
    });

    const campaignContactId =
      typeof body.campaignContactId === 'string'
        ? body.campaignContactId.slice(0, 100)
        : null;

    const { data: inserted, error: insertError } = await ctx.supabase
      .from('call_sessions')
      .insert({
        account_id: ctx.accountId,
        direction: 'outbound',
        provider: 'livekit',
        room_name: room,
        status: 'ringing',
        from_number: resolved.callerId,
        to_number: to,
        contact_id: contactId,
        conversation_id:
          typeof body.conversationId === 'string' ? body.conversationId : null,
        lead_id: typeof body.leadId === 'string' ? body.leadId : null,
        agent_profile_id: ctx.profileId,
        agent_user_id: ctx.userId,
        metadata: {
          source: 'softphone',
          tab_id:
            typeof body.tabId === 'string'
              ? body.tabId.slice(0, 100)
              : undefined,
          campaign_contact_id: campaignContactId ?? undefined,
        },
      })
      .select('*')
      .single();

    if (insertError) {
      if (insertError.code === '42P01' || insertError.code === 'PGRST205') {
        return NextResponse.json(
          {
            error:
              'Falta aplicar la migración 112_telephony.sql en la base de datos.',
          },
          { status: 400 }
        );
      }
      throw insertError;
    }

    const call = inserted as CallSession;

    await ctx.supabase.from('call_events').insert({
      account_id: ctx.accountId,
      call_id: call.id,
      type: 'created',
      actor_user_id: ctx.userId,
      payload: { to, room, contact_id: contactId },
    });

    // Campaña (124): la llamada queda ligada al contacto que el agente
    // reclamó. Si la 124 no está aplicada la llamada sigue, sin
    // vínculo; cualquier otro fallo se registra y tampoco la corta.
    if (campaignContactId) {
      const { error: attachError } = await ctx.supabase.rpc(
        'attach_campaign_call',
        { p_contact_id: campaignContactId, p_call_id: call.id }
      );
      if (attachError && attachError.code !== '42883') {
        console.warn(
          '[telephony] no se pudo vincular el contacto de campaña:',
          attachError
        );
      }
    }

    // El agente queda ocupado en cuanto marca.
    await setAgentStatusRpc(ctx.supabase, 'busy', { source: 'system' });

    try {
      await dialPstn({
        trunkId: resolved.trunkId!,
        to,
        room,
        fromNumber: resolved.callerId,
        participantName: contactName ?? to,
      });
    } catch (dialError) {
      console.error('[telephony] fallo al marcar por SIP:', dialError);
      await finalizeCall({
        db: ctx.supabase,
        call,
        reason: 'failed',
        contactName,
        createActivity: false,
      }).catch(() => undefined);
      return NextResponse.json(
        {
          error:
            'LiveKit no pudo iniciar la llamada. Revisa la troncal SIP y el número.',
          call,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      call,
      token: token.token,
      url: token.url,
      room,
    });
  } catch (err) {
    return telephonyErrorResponse(err);
  }
}
