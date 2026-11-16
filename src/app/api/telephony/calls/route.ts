import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import {
  loadTelephonyConfig,
  resolveTelephony,
  telephonyBlockReason,
} from '@/lib/telephony/config';
import { newCallRoomName } from '@/lib/telephony/calls';
import { finalizeCall } from '@/lib/telephony/finalize';
import { telephonyErrorResponse } from '@/lib/telephony/http';
import { createAgentToken, dialPstn } from '@/lib/telephony/livekit';
import { normalizePhone } from '@/lib/telephony/phone';
import { setAgentStatusRpc } from '@/lib/telephony/status';
import type { CallSession } from '@/types';

/**
 * GET  /api/telephony/calls — historial (últimas 50 por defecto).
 * POST /api/telephony/calls — inicia una llamada saliente a la PSTN.
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
    const limit = Math.min(
      Math.max(Number(url.searchParams.get('limit') ?? 50), 1),
      100
    );
    const contactId = url.searchParams.get('contactId');

    let query = ctx.supabase
      .from('call_sessions')
      .select('*, contact:contacts(id, name, phone)')
      .eq('account_id', ctx.accountId)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (contactId) query = query.eq('contact_id', contactId);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ calls: (data ?? []) as CallSession[] });
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
          campaign_contact_id:
            typeof body.campaignContactId === 'string'
              ? body.campaignContactId.slice(0, 100)
              : undefined,
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
