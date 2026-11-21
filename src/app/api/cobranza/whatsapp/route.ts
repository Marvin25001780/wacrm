import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  SendMessageError,
  sendMessageToConversation,
} from '@/lib/whatsapp/send-message';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import {
  WHATSAPP_TEXT_LIMIT,
  WHATSAPP_WINDOW_HOURS,
  templateVariableCount,
} from '@/lib/collections/whatsapp';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * GET /api/cobranza/whatsapp?debtor_id=â€¦
 *
 * Contexto de WhatsApp de un deudor para la consola:
 *   - target: contacto/hilo/telÃ©fono y estado de la lÃ­nea (RPC 127)
 *   - messages: Ãºltimos 30 mensajes del hilo, en orden cronolÃ³gico
 *   - templates: plantillas aprobadas del negocio
 *
 * El RPC es SECURITY DEFINER y valida la pertenencia; el resto de
 * lecturas van con la sesiÃ³n del agente y las policies de la cuenta.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const debtorId = new URL(request.url).searchParams.get('debtor_id');

    if (!debtorId || !isUuid(debtorId)) {
      return NextResponse.json(
        { error: 'Falta el deudor o el identificador no es vÃ¡lido.' },
        { status: 400 }
      );
    }

    const targetResult = await ctx.supabase.rpc('collection_whatsapp_target', {
      p_debtor_id: debtorId,
    });
    if (targetResult.error) return rpcErrorResponse(targetResult.error);

    const target = firstRow(targetResult.data);
    if (!target) {
      return NextResponse.json(
        { error: 'Deudor no encontrado.' },
        { status: 404 }
      );
    }

    const [threadResult, templatesResult] = await Promise.all([
      ctx.supabase.rpc('collection_whatsapp_thread', {
        p_debtor_id: debtorId,
        p_limit: 30,
      }),
      ctx.supabase
        .from('message_templates')
        .select(
          'id, name, language, category, header_type, header_content, body_text, status'
        )
        .eq('account_id', target.account_id)
        .eq('status', 'APPROVED')
        .order('name', { ascending: true }),
    ]);

    if (threadResult.error) return rpcErrorResponse(threadResult.error);

    if (templatesResult.error) {
      // Sin catÃ¡logo se puede seguir respondiendo texto; no se inventa
      // una lista vacÃ­a silenciosa: se informa para que el admin sepa.
      console.error(
        '[cobranza/whatsapp] templates',
        templatesResult.error.message
      );
    }

    return NextResponse.json({
      target,
      messages: threadResult.data ?? [],
      templates: templatesResult.error ? [] : (templatesResult.data ?? []),
      templatesError: templatesResult.error?.message ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/cobranza/whatsapp
 *
 * EnvÃ­a un texto libre o una plantilla aprobada al deudor, por el
 * mismo camino que el inbox (`sendMessageToConversation`), y devuelve
 * el hilo y el id del mensaje en Meta.
 *
 * Body:
 *   debtor_id        UUID obligatorio
 *   message_type     text | template
 *   content_text     obligatorio si text (mÃ¡x. 4096)
 *   template_name    obligatorio si template (aprobada del negocio)
 *   template_params  valores de {{1}}, {{2}}â€¦ del cuerpo
 *
 * Reglas de Meta que se respetan aquÃ­:
 *   - El primer mensaje (o fuera de la ventana de 24 h) debe ser
 *     plantilla; el texto libre se rechaza con un mensaje claro.
 *   - La plantilla se busca en la base por nombre y estado; no se
 *     confÃ­a en el idioma que manda el navegador.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `cobranza-wa:${ctx.userId}`,
      RATE_LIMITS.send
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const debtorId = asUuid(body.debtor_id);
    if (!debtorId) {
      return NextResponse.json({ error: 'Falta el deudor.' }, { status: 400 });
    }

    const messageType = asText(body.message_type, 20);
    if (messageType !== 'text' && messageType !== 'template') {
      return NextResponse.json(
        { error: 'El tipo de mensaje debe ser text o template.' },
        { status: 400 }
      );
    }

    const targetResult = await ctx.supabase.rpc('collection_whatsapp_target', {
      p_debtor_id: debtorId,
    });
    if (targetResult.error) return rpcErrorResponse(targetResult.error);

    const target = firstRow(targetResult.data) as
      | {
          account_id: string;
          contact_id: string | null;
          conversation_id: string | null;
          display_name: string;
          phone_e164: string | null;
          whatsapp_configured: boolean;
        }
      | null;

    if (!target) {
      return NextResponse.json(
        { error: 'Deudor no encontrado.' },
        { status: 404 }
      );
    }
    if (target.account_id !== ctx.accountId) {
      return NextResponse.json(
        { error: 'No perteneces a este negocio.' },
        { status: 403 }
      );
    }
    if (!target.phone_e164) {
      return NextResponse.json(
        { error: 'El deudor no tiene un telÃ©fono vÃ¡lido para WhatsApp.' },
        { status: 400 }
      );
    }
    if (!target.whatsapp_configured) {
      return NextResponse.json(
        {
          error:
            'La cuenta no tiene una lÃ­nea de WhatsApp configurada. ConfigÃºrala en Ajustes â†’ WhatsApp.',
          code: 'whatsapp_not_configured',
        },
        { status: 409 }
      );
    }

    // ---- hilo: usar el existente o crearlo con la lÃ­nea por defecto ----
    let conversationId = target.conversation_id;
    if (!conversationId) {
      const resolved = await resolveConversationByPhone(
        ctx.supabase,
        ctx.accountId,
        target.phone_e164,
        target.display_name
      );
      conversationId = resolved.conversationId;

      if (!target.contact_id) {
        await ctx.supabase
          .from('collection_debtors')
          .update({ contact_id: resolved.contactId })
          .eq('id', debtorId)
          .eq('account_id', ctx.accountId);
      }
    }

    // ---- texto libre: solo dentro de la ventana de 24 h ----
    if (messageType === 'text') {
      const lastInbound = await loadLastInbound(ctx.supabase, conversationId);
      const windowOpen =
        lastInbound !== null &&
        Date.parse(lastInbound) + WHATSAPP_WINDOW_HOURS * 60 * 60 * 1000 >
          Date.now();

      if (!windowOpen) {
        return NextResponse.json(
          {
            error:
              'Fuera de la ventana de 24 h: el deudor no ha escrito y WhatsApp no permite texto libre. EnvÃ­a una plantilla aprobada.',
            code: 'window_closed',
          },
          { status: 409 }
        );
      }
    }

    // ---- plantilla: resolver nombre, idioma y variables en la base ----
    let templateName: string | undefined;
    let templateLanguage: string | undefined;
    let templateParams: string[] | undefined;

    if (messageType === 'template') {
      const requested = asText(body.template_name, 120);
      if (!requested) {
        return NextResponse.json(
          { error: 'Elige una plantilla.' },
          { status: 400 }
        );
      }

      const { data: template, error: templateError } = await ctx.supabase
        .from('message_templates')
        .select('name, language, body_text, status')
        .eq('account_id', ctx.accountId)
        .eq('name', requested)
        .eq('status', 'APPROVED')
        .maybeSingle();

      if (templateError) {
        console.error('[cobranza/whatsapp] template', templateError.message);
        return NextResponse.json(
          { error: 'No se pudo leer la plantilla.' },
          { status: 500 }
        );
      }
      if (!template) {
        return NextResponse.json(
          {
            error:
              'Esa plantilla no estÃ¡ aprobada en este negocio. Sincroniza las plantillas en Ajustes â†’ WhatsApp.',
          },
          { status: 400 }
        );
      }

      const required = templateVariableCount(String(template.body_text ?? ''));
      const rawParams = Array.isArray(body.template_params)
        ? body.template_params
        : [];
      const values = rawParams.map((value) => asText(value, 300));
      if (required > 0 && values.slice(0, required).some((v) => !v)) {
        return NextResponse.json(
          {
            error: `Esta plantilla necesita ${required} valor${
              required === 1 ? '' : 'es'
            } para sus variables.`,
          },
          { status: 400 }
        );
      }

      templateName = String(template.name);
      templateLanguage = (template.language as string | null) ?? 'es';
      templateParams = values.slice(0, required);
    }

    const contentText =
      messageType === 'text' ? asText(body.content_text, WHATSAPP_TEXT_LIMIT) : '';

    if (messageType === 'text' && !contentText) {
      return NextResponse.json(
        { error: 'Escribe el mensaje antes de enviarlo.' },
        { status: 400 }
      );
    }

    try {
      const result = await sendMessageToConversation(ctx.supabase, ctx.accountId, {
        conversationId,
        messageType,
        contentText: contentText || undefined,
        templateName,
        templateLanguage,
        templateParams,
        senderId: ctx.userId,
      });

      return NextResponse.json({
        conversationId,
        messageId: result.messageId,
        whatsappMessageId: result.whatsappMessageId,
      });
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.status }
        );
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------

async function loadLastInbound(
  supabase: SupabaseClient,
  conversationId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.created_at as string | undefined) ?? null;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null;
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return null;
}

function rpcErrorResponse(error: { code?: string; message?: string }) {
  const message = error.message ?? 'No se pudo leer el contexto de WhatsApp.';

  if (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    error.code === 'PGRST205'
  ) {
    return NextResponse.json(
      {
        error:
          'Falta aplicar la migraciÃ³n 127_collection_whatsapp.sql para usar WhatsApp en la consola.',
        migration: '127',
      },
      { status: 409 }
    );
  }
  if (error.code === '42501') {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  if (error.code === 'P0002') {
    return NextResponse.json({ error: 'Deudor no encontrado.' }, { status: 404 });
  }
  return NextResponse.json({ error: message }, { status: 400 });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

function asUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return isUuid(value) ? value.trim() : null;
}

function asText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}
