import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import {
  loadTranscriptionConfig,
  transcribeAudio,
  transcriptionProvider,
} from '@/lib/ai/transcribe';
import type { CallSession } from '@/types';

const MAX_RECORDING_BYTES = 24 * 1024 * 1024;

function mimeFromFilename(filename: string): string {
  if (filename.endsWith('.mp3')) return 'audio/mpeg';
  if (filename.endsWith('.m4a')) return 'audio/mp4';
  if (filename.endsWith('.wav')) return 'audio/wav';
  if (filename.endsWith('.webm')) return 'audio/webm';
  return 'audio/ogg';
}

/**
 * POST /api/telephony/calls/[id]/transcribe
 *
 * Transcribe la grabación de una llamada con el proveedor de IA del
 * negocio (OpenAI, Groq o Gemini). Requiere que la grabación esté en
 * una URL http(s) accesible (bucket público o URL firmada).
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;

    const { data, error } = await ctx.supabase
      .from('call_sessions')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'Llamada no encontrada.' },
        { status: 404 }
      );
    }

    const call = data as CallSession;
    if (call.transcript_status === 'done' && call.transcript) {
      return NextResponse.json({ call });
    }
    if (!call.recording_url) {
      return NextResponse.json(
        {
          error:
            'La llamada no tiene una grabación descargable. Revisa la configuración de Egress y TELEPHONY_RECORDINGS_PUBLIC_BASE_URL.',
        },
        { status: 400 }
      );
    }

    const config = await loadTranscriptionConfig(
      supabaseAdmin(),
      ctx.accountId
    );
    const provider = config ? transcriptionProvider(config.provider) : null;
    if (!config || !provider) {
      return NextResponse.json(
        {
          error:
            'El negocio no tiene un proveedor de transcripción configurado (OpenAI, Groq o Gemini) en Ajustes → Asistente de IA.',
        },
        { status: 400 }
      );
    }

    await ctx.supabase
      .from('call_sessions')
      .update({ transcript_status: 'processing' })
      .eq('id', call.id);

    const res = await fetch(call.recording_url);
    if (!res.ok) {
      await markFailed(
        ctx.supabase,
        call,
        `No se pudo descargar la grabación (${res.status}).`
      );
      return NextResponse.json(
        { error: `No se pudo descargar la grabación (${res.status}).` },
        { status: 502 }
      );
    }

    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_RECORDING_BYTES) {
      await markFailed(ctx.supabase, call, 'La grabación supera los 24 MB.');
      return NextResponse.json(
        {
          error:
            'La grabación supera los 24 MB; recorta la llamada o usa un modelo con más límite.',
        },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_RECORDING_BYTES) {
      await markFailed(
        ctx.supabase,
        call,
        'La grabación está vacía o supera los 24 MB.'
      );
      return NextResponse.json(
        { error: 'La grabación está vacía o supera los 24 MB.' },
        { status: 400 }
      );
    }

    const filename =
      call.recording_url.split('?')[0].split('/').pop() || `${call.id}.ogg`;
    const mimeType =
      res.headers.get('content-type')?.split(';')[0] ||
      mimeFromFilename(filename);

    const transcript = await transcribeAudio({
      provider,
      apiKey: config.apiKey,
      model: config.model ?? undefined,
      buffer,
      mimeType,
      filename,
    });

    const { data: updated, error: updateError } = await ctx.supabase
      .from('call_sessions')
      .update({ transcript, transcript_status: 'done' })
      .eq('id', call.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    await ctx.supabase.from('call_events').insert({
      account_id: ctx.accountId,
      call_id: call.id,
      type: 'transcribed',
      actor_user_id: ctx.userId,
      payload: { provider, chars: transcript.length },
    });

    return NextResponse.json({ call: updated as CallSession });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function markFailed(
  db: SupabaseClient,
  call: CallSession,
  message: string
) {
  await db
    .from('call_sessions')
    .update({ transcript_status: 'failed' })
    .eq('id', call.id);
  await db.from('call_events').insert({
    account_id: call.account_id,
    call_id: call.id,
    type: 'transcription_failed',
    payload: { message: message.slice(0, 500) },
  });
}
