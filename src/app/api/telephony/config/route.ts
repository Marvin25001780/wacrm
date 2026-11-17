import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  loadTelephonyConfig,
  normalizeInboundNumbers,
  normalizeQueueMaxWaitSeconds,
} from '@/lib/telephony/config';
import { telephonyEnv } from '@/lib/telephony/env';
import { normalizePhone } from '@/lib/telephony/phone';
import {
  MAX_SKILLS,
  normalizeSkillList,
  normalizeSkillOverflowSeconds,
} from '@/lib/telephony/skills';
import {
  normalizeMaxTransfers,
  normalizeTransferRingTimeout,
} from '@/lib/telephony/transfers';

/**
 * GET   /api/telephony/config — configuración del negocio (admin+).
 * PATCH /api/telephony/config — crea o actualiza la fila.
 *
 * Body (todos opcionales):
 *   { enabled, outboundCallerId, sipOutboundTrunkId, inboundNumbers,
 *     recordingEnabled, transcriptionEnabled, queueMaxWaitSeconds,
 *     requiredSkills, skillOverflowSeconds }
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const loaded = await loadTelephonyConfig(ctx.supabase, ctx.accountId);
    return NextResponse.json({
      config: loaded.row,
      migrationMissing: loaded.migrationMissing,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo inválido.' }, { status: 400 });
    }

    const env = telephonyEnv();
    const patch: Record<string, unknown> = {};

    if ('enabled' in body) patch.enabled = Boolean(body.enabled);

    if ('outboundCallerId' in body) {
      const raw = body.outboundCallerId;
      if (raw == null || raw === '') {
        patch.outbound_caller_id = null;
      } else {
        const e164 = normalizePhone(raw);
        if (!e164) {
          return NextResponse.json(
            { error: 'El número saliente no es válido (usa +58…).' },
            { status: 400 }
          );
        }
        patch.outbound_caller_id = e164;
      }
    }

    if ('sipOutboundTrunkId' in body) {
      const raw = body.sipOutboundTrunkId;
      const value = typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
      patch.sip_outbound_trunk_id = value || null;
    }

    if ('inboundNumbers' in body) {
      const input = Array.isArray(body.inboundNumbers)
        ? body.inboundNumbers
        : [];
      const numbers = normalizeInboundNumbers(input);
      if (input.length > 0 && numbers.length === 0) {
        return NextResponse.json(
          { error: 'Ninguno de los números entrantes es válido.' },
          { status: 400 }
        );
      }
      if (numbers.length > 0) {
        const { data: clash } = await ctx.supabase
          .from('telephony_config')
          .select('account_id')
          .neq('account_id', ctx.accountId)
          .overlaps('inbound_numbers', numbers)
          .limit(1);
        if (clash && clash.length > 0) {
          return NextResponse.json(
            {
              error:
                'Uno de esos números ya está asignado a otro negocio. Cada número entrante pertenece a un solo negocio.',
            },
            { status: 409 }
          );
        }
      }
      patch.inbound_numbers = numbers;
    }

    if ('recordingEnabled' in body) {
      const wanted = Boolean(body.recordingEnabled);
      if (wanted && !env.recordingEnabled) {
        return NextResponse.json(
          {
            error:
              'La grabación no está habilitada en el servidor. Configura LIVEKIT_RECORDING_ENABLED=true y el almacenamiento de Egress.',
          },
          { status: 400 }
        );
      }
      patch.recording_enabled = wanted;
    }

    if ('transcriptionEnabled' in body) {
      patch.transcription_enabled = Boolean(body.transcriptionEnabled);
    }

    if ('queueMaxWaitSeconds' in body) {
      const queueMaxWaitSeconds = normalizeQueueMaxWaitSeconds(
        body.queueMaxWaitSeconds
      );
      if (queueMaxWaitSeconds === null) {
        return NextResponse.json(
          {
            error:
              'La espera máxima en cola debe ser un número entre 0 y 3600 segundos.',
          },
          { status: 400 }
        );
      }
      patch.queue_max_wait_seconds = queueMaxWaitSeconds;
    }

    if ('requiredSkills' in body) {
      const normalized = normalizeSkillList(body.requiredSkills);
      if (normalized.rejected.length > 0) {
        return NextResponse.json(
          {
            error:
              'Cada habilidad debe ser texto de hasta 30 caracteres (sin comas).',
          },
          { status: 400 }
        );
      }
      if (normalized.overflow > 0) {
        return NextResponse.json(
          { error: `Máximo ${MAX_SKILLS} habilidades por cola.` },
          { status: 400 }
        );
      }
      patch.required_skills = normalized.skills;
    }

    if ('skillOverflowSeconds' in body) {
      const skillOverflowSeconds = normalizeSkillOverflowSeconds(
        body.skillOverflowSeconds
      );
      if (skillOverflowSeconds === null) {
        return NextResponse.json(
          {
            error:
              'El desbordamiento por habilidad debe ser un número entre 0 y 3600 segundos.',
          },
          { status: 400 }
        );
      }
      patch.skill_overflow_seconds = skillOverflowSeconds;
    }

    if ('transferRingTimeoutSeconds' in body) {
      const timeout = normalizeTransferRingTimeout(
        body.transferRingTimeoutSeconds
      );
      if (timeout === null) {
        return NextResponse.json(
          {
            error:
              'El timbre de transferencia debe ser un número entre 5 y 300 segundos.',
          },
          { status: 400 }
        );
      }
      patch.transfer_ring_timeout_seconds = timeout;
    }

    if ('maxTransfersPerCall' in body) {
      const maxTransfers = normalizeMaxTransfers(body.maxTransfersPerCall);
      if (maxTransfers === null) {
        return NextResponse.json(
          {
            error:
              'El máximo de transferencias debe ser un número entre 0 y 10 (0 = sin límite).',
          },
          { status: 400 }
        );
      }
      patch.max_transfers_per_call = maxTransfers;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: 'No hay cambios que guardar.' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('telephony_config')
      .upsert(
        { account_id: ctx.accountId, created_by: ctx.userId, ...patch },
        { onConflict: 'account_id' }
      )
      .select('*')
      .single();

    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return NextResponse.json(
          {
            error:
              'Falta aplicar la migración 112_telephony.sql en la base de datos.',
          },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: true, config: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
