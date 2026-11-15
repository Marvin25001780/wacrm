import { NextResponse, after } from 'next/server';
import { WebhookReceiver } from 'livekit-server-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/ai/admin-client';
import { findAccountByInboundNumber } from '@/lib/telephony/config';
import { isTerminalCallStatus, isTelephonyRoom } from '@/lib/telephony/calls';
import { recordingUrlFromEgress, telephonyEnv } from '@/lib/telephony/env';
import { finalizeCall } from '@/lib/telephony/finalize';
import { normalizePhone } from '@/lib/telephony/phone';
import { transcribeCallRecording } from '@/lib/telephony/transcribe-call';
import type { CallSession } from '@/types';

/**
 * POST /api/telephony/webhook — eventos de LiveKit.
 *
 * Verifica la firma con el API secret (header Authorization). Es la
 * fuente de verdad cuando el navegador se cae: `room_finished`
 * cierra la sesión y escribe la actividad igual que el botón colgar.
 *
 * Entrantes: si la sala trae `metadata.account_id` (regla de
 * despacho) o el número marcado está en `telephony_config`, se crea
 * la sesión. Salas ajenas a este CRM se ignoran.
 */
export async function POST(request: Request) {
  const env = telephonyEnv();
  if (!env.url || !env.apiKey || !env.apiSecret) {
    return NextResponse.json(
      { error: 'telephony not configured' },
      { status: 503 }
    );
  }

  const raw = await request.text();
  const receiver = new WebhookReceiver(env.apiKey, env.apiSecret);
  let event;
  try {
    event = await receiver.receive(
      raw,
      request.headers.get('authorization') ?? undefined
    );
  } catch (err) {
    console.warn('[telephony] webhook con firma inválida:', err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const roomName = event.room?.name ?? event.egressInfo?.roomName ?? '';
  if (!isTelephonyRoom(roomName)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = supabaseAdmin();
  try {
    switch (event.event) {
      case 'participant_joined':
        await handleParticipantJoined(db, {
          roomName,
          roomMetadata: event.room?.metadata,
          attributes: event.participant?.attributes ?? {},
        });
        break;
      case 'participant_left':
        await handleParticipantLeft(db, {
          roomName,
          isSip: Boolean(event.participant?.attributes?.['sip.phoneNumber']),
        });
        break;
      case 'room_finished':
        await closeByRoom(db, roomName, 'hangup');
        break;
      case 'egress_ended':
        await handleEgressEnded(db, roomName, {
          egressId: event.egressInfo?.egressId,
          location:
            event.egressInfo?.fileResults?.[0]?.location ||
            event.egressInfo?.fileResults?.[0]?.filename ||
            null,
          error: event.egressInfo?.error || null,
        });
        break;
      default:
        break;
    }
  } catch (err) {
    // LiveKit reintenta si respondemos 5xx; registramos y devolvemos
    // 200 para no entrar en un bucle por un evento que no aplica.
    console.error('[telephony] error procesando webhook:', event.event, err);
  }

  return NextResponse.json({ ok: true });
}

async function findCall(
  db: SupabaseClient,
  roomName: string
): Promise<CallSession | null> {
  const { data } = await db
    .from('call_sessions')
    .select('*')
    .eq('room_name', roomName)
    .maybeSingle();
  return (data as CallSession | null) ?? null;
}

async function handleParticipantJoined(
  db: SupabaseClient,
  args: {
    roomName: string;
    roomMetadata?: string;
    attributes: Record<string, string>;
  }
) {
  const caller = normalizePhone(args.attributes['sip.phoneNumber']);
  const dialed = normalizePhone(args.attributes['sip.trunkPhoneNumber']);
  if (!caller) return; // no es un participante SIP

  const existing = await findCall(db, args.roomName);
  if (existing) return; // saliente: la sesión ya la creó la API

  const accountId = await resolveInboundAccountId(
    db,
    args.roomMetadata,
    dialed
  );
  if (!accountId) {
    console.warn('[telephony] llamada entrante sin negocio asignado:', dialed);
    return;
  }

  // Contacto por teléfono (misma normalización que el CRM).
  const digits = caller.replace(/\D/g, '');
  const { data: contact } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('phone_normalized', digits)
    .maybeSingle();

  const { data: created, error } = await db
    .from('call_sessions')
    .insert({
      account_id: accountId,
      direction: 'inbound',
      provider: 'livekit',
      room_name: args.roomName,
      status: 'ringing',
      from_number: caller,
      to_number: dialed,
      contact_id: (contact?.id as string | undefined) ?? null,
      metadata: { source: 'inbound' },
    })
    .select('*')
    .single();

  if (error) throw error;

  await db.from('call_events').insert({
    account_id: accountId,
    call_id: (created as CallSession).id,
    type: 'inbound_created',
    payload: { from: caller, to: dialed },
  });
}

async function resolveInboundAccountId(
  db: SupabaseClient,
  roomMetadata: string | undefined,
  dialed: string | null
): Promise<string | null> {
  if (roomMetadata) {
    try {
      const parsed = JSON.parse(roomMetadata) as { account_id?: unknown };
      if (typeof parsed.account_id === 'string') return parsed.account_id;
    } catch {
      // metadata no-JSON: seguimos con el número marcado.
    }
  }
  const match = await findAccountByInboundNumber(db, dialed);
  return match?.accountId ?? null;
}

async function handleParticipantLeft(
  db: SupabaseClient,
  args: { roomName: string; isSip: boolean }
) {
  const call = await findCall(db, args.roomName);
  if (!call || isTerminalCallStatus(call.status)) return;
  // Cualquiera de los dos lados que cuelgue termina la llamada 1:1.
  await finalizeCall({
    db,
    call,
    reason: args.isSip ? 'hangup' : 'agent_left',
  });
}

async function closeByRoom(
  db: SupabaseClient,
  roomName: string,
  reason: 'hangup' | 'agent_left'
) {
  const call = await findCall(db, roomName);
  if (!call || isTerminalCallStatus(call.status)) return;
  await finalizeCall({ db, call, reason });
}

async function handleEgressEnded(
  db: SupabaseClient,
  roomName: string,
  args: { egressId?: string; location: string | null; error: string | null }
) {
  const call = await findCall(db, roomName);
  if (!call) return;

  const env = telephonyEnv();
  const url = recordingUrlFromEgress(
    args.location,
    env.recordingsPublicBaseUrl
  );

  // Un reintento del webhook no debe devolver a "pending" una
  // transcripción ya hecha o en curso.
  const keepStatus =
    call.transcript_status === 'done' || call.transcript_status === 'processing';
  const transcriptStatus = keepStatus
    ? call.transcript_status
    : url
      ? 'pending'
      : 'none';

  await db
    .from('call_sessions')
    .update({
      recording_url: url,
      transcript_status: transcriptStatus,
    })
    .eq('id', call.id);

  await db.from('call_events').insert({
    account_id: call.account_id,
    call_id: call.id,
    type: args.error ? 'recording_failed' : 'recording_ready',
    payload: {
      egress_id: args.egressId ?? null,
      location: args.location,
      error: args.error,
    },
  });

  if (!url || args.error) return;
  if (!(await accountTranscribesCalls(db, call.account_id))) return;

  // La descarga + el proveedor pueden tardar más de lo que LiveKit
  // espera por el webhook; se ejecuta después de responder.
  after(async () => {
    try {
      const fresh = await findCall(db, roomName);
      if (!fresh) return;
      const outcome = await transcribeCallRecording(db, fresh, {
        source: 'automatic',
      });
      if (outcome.error) {
        console.warn(
          '[telephony] transcripción automática falló:',
          outcome.error
        );
      }
    } catch (err) {
      console.error('[telephony] transcripción automática:', err);
    }
  });
}

/** ¿El negocio pidió transcribir sus grabaciones? (sin fila = sí). */
async function accountTranscribesCalls(
  db: SupabaseClient,
  accountId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('telephony_config')
    .select('transcription_enabled')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) return false;
  const row = data as { transcription_enabled?: boolean } | null;
  return row?.transcription_enabled ?? true;
}
