// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import { evolutionSendText, evolutionSendMedia, type EvoMediaType } from '@/lib/channels/evolution';
import {
  sendMetaText,
  sendMetaAttachment,
  metaAttachmentType,
} from '@/lib/channels/meta';
import { loadSmsConfig } from '@/lib/sms/config';
import { textbeeSendSms } from '@/lib/sms/textbee';
import { extractGatewayMessageId } from '@/lib/sms/persist';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  replyToMessageId?: string | null;
  /**
   * `auth.users.id` del agente que envía. Se persiste en
   * `messages.sender_id` para atribuir el mensaje en las métricas de
   * productividad/mensajería. Omitir en envíos de sistema (bot,
   * automatizaciones, API pública).
   */
  senderId?: string | null;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    replyToMessageId,
    senderId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({ messageType, contentText, mediaUrl, templateName });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;

  // Los hilos de Instagram/Facebook no se envían por teléfono (Meta
  // Send API) sino por la página, con el id de plataforma del contacto.
  const conversationChannel =
    typeof conversation.channel === 'string' ? conversation.channel : 'whatsapp';
  if (conversationChannel === 'instagram' || conversationChannel === 'facebook') {
    return sendMetaChannelMessage(db, accountId, {
      conversationId,
      channel: conversationChannel,
      contact,
      externalContactId:
        typeof conversation.external_contact_id === 'string'
          ? conversation.external_contact_id
          : null,
      messageType,
      contentText,
      mediaUrl,
      senderId,
      replyToMessageId,
    });
  }

  // Los hilos de TikTok existen (la cuenta se conecta por Login Kit),
  // pero el envío de DMs exige acceso de partner a la Business Messaging
  // API de TikTok. Devolvemos un error claro en vez de fallar por falta
  // de teléfono.
  if (conversationChannel === 'tiktok') {
    throw new SendMessageError(
      'tiktok_messaging_unavailable',
      'El envío de mensajes de TikTok requiere acceso de partner aprobado por TikTok (Business Messaging API). La cuenta está conectada, pero la mensajería todavía no está habilitada.',
      400
    );
  }

  // Los hilos SMS tienen su propio canal: se mandan por el gateway
  // textbee de la cuenta, no por WhatsApp. Solo texto.
  if (conversationChannel === 'sms') {
    if (messageType !== 'text') {
      throw new SendMessageError(
        'bad_request',
        'SMS solo admite mensajes de texto.',
        400
      );
    }
    if (!contact?.phone) {
      throw new SendMessageError('bad_request', 'Contact phone number not found', 400);
    }

    const smsConfig = await loadSmsConfig(db, accountId);
    if (!smsConfig) {
      throw new SendMessageError(
        'sms_not_configured',
        'SMS no está configurado. Un administrador debe agregar el device id y API key de textbee.',
        400
      );
    }

    const result = await textbeeSendSms(
      smsConfig.deviceId,
      smsConfig.apiKey,
      contact.phone,
      contentText ?? ''
    );
    if (!result.ok) {
      console.error('[send-message] SMS send failed:', result.status, result.error);
      throw new SendMessageError(
        'sms_error',
        `Gateway SMS error: ${result.error}`,
        502
      );
    }

    const gatewayId = extractGatewayMessageId(result.data);
    const smsMessageId = gatewayId ?? `sms_${Date.now()}`;

    const { data: messageRecord, error: msgError } = await db
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: senderId ?? null,
        content_type: 'text',
        content_text: contentText || null,
        media_url: null,
        template_name: null,
        message_id: smsMessageId,
        status: 'sent',
        reply_to_message_id: replyToMessageId || null,
        channel: 'sms',
      })
      .select()
      .single();

    if (msgError) {
      console.error('[send-message] error inserting SMS message:', msgError);
      throw new SendMessageError(
        'db_error',
        `SMS sent but failed to save to DB: ${msgError.message}`,
        500
      );
    }

    await db
      .from('conversations')
      .update({
        last_message_text: contentText || '[...]',
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    // Pausar flujos activos del contacto (el agente tomó la mano).
    try {
      const { error: pauseErr } = await supabaseAdmin()
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .eq('status', 'active');
      if (pauseErr) {
        console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
      }
    } catch (err) {
      console.error(
        '[flows] pause-on-agent-send threw:',
        err instanceof Error ? err.message : err
      );
    }

    return { messageId: messageRecord.id, whatsappMessageId: gatewayId ?? '' };
  }

  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  // WhatsApp config, account-scoped. Si la cuenta no tiene Meta Cloud
  // API, caemos a un canal Evolution (Baileys) activo — el camino que
  // usa la bandeja para un número conectado por QR.
  const { data: config } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (!config) {
    return sendEvolutionMessage(db, accountId, {
      conversationId,
      contact,
      messageType,
      contentText,
      mediaUrl,
      filename,
      senderId,
      replyToMessageId,
    });
  }

  const accessToken = decrypt(config.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
    }
  }

  // Template row (for header + button components). isMessageTemplate
  // guards against a malformed local row crashing the send-builder.
  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();
    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
  }

  const attempt = async (phone: string): Promise<string> => {
    if (messageType === 'template') {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: templateName!,
        language: templateLanguage || 'en_US',
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMediaMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    const result = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: contentText!,
      contextMessageId,
    });
    return result.messageId;
  };

  // Send via Meta — retry across phone-number variants if Meta rejects
  // with "recipient not in allowed list"; persist a working variant
  // back to the contact so the next send goes straight through.
  let waMessageId = '';
  let workingPhone = sanitizedPhone;
  try {
    const variants = phoneVariants(sanitizedPhone);
    let lastError: unknown = null;

    for (const variant of variants) {
      try {
        waMessageId = await attempt(variant);
        workingPhone = variant;
        lastError = null;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(message)) {
          throw err;
        }
        lastError = err;
        console.warn(
          `[send-message] variant "${variant}" rejected by Meta, trying next…`
        );
      }
    }

    if (lastError) throw lastError;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[send-message] Meta send failed for all variants:', message);
    throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
  }

  if (workingPhone !== sanitizedPhone) {
    console.log(
      `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
    );
    await db
      .from('contacts')
      .update({ phone: workingPhone })
      .eq('id', contact.id);
  }

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      sender_id: senderId ?? null,
      content_type: messageType,
      content_text: contentText || null,
      media_url: mediaUrl || null,
      template_name: templateName || null,
      message_id: waMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}

/**
 * Envío saliente de respaldo por Evolution API (WhatsApp/Baileys).
 *
 * Se usa cuando la cuenta NO tiene `whatsapp_config` (Meta) pero sí un
 * canal `evolution` activo conectado por QR. Persiste el mensaje con
 * `channel = 'whatsapp'` (es WhatsApp) y pausa los flujos activos del
 * contacto, igual que el camino de Meta. Hoy soporta solo texto.
 */
async function sendEvolutionMessage(
  db: SupabaseClient,
  accountId: string,
  params: {
    conversationId: string;
    contact: { id: string; phone: string | null } | null;
    messageType: string;
    contentText?: string | null;
    mediaUrl?: string | null;
    filename?: string | null;
    senderId?: string | null;
    replyToMessageId?: string | null;
  }
): Promise<SendMessageResult> {
  const {
    conversationId,
    contact,
    messageType,
    contentText,
    mediaUrl,
    filename,
    senderId,
    replyToMessageId,
  } = params;

  const { data: row } = await db
    .from('channel_configs')
    .select('config, is_active')
    .eq('account_id', accountId)
    .eq('channel', 'evolution')
    .maybeSingle();

  const cfg = (row?.config ?? {}) as Record<string, unknown>;
  const baseUrl = typeof cfg.base_url === 'string' ? cfg.base_url : '';
  const instance = typeof cfg.instance === 'string' ? cfg.instance : '';
  const apiKeyEnc = typeof cfg.api_key === 'string' ? cfg.api_key : '';

  if (!row?.is_active || !baseUrl || !instance || !apiKeyEnc) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp no está configurado. Conecta un número (Meta o Evolution) primero.',
      400
    );
  }

  if (messageType !== 'text' && !MEDIA_KINDS.includes(messageType as typeof MEDIA_KINDS[number])) {
    throw new SendMessageError(
      'bad_request',
      `Por WhatsApp (Evolution) no se soporta el tipo de mensaje "${messageType}".`,
      400
    );
  }

  if (!contact?.phone) {
    throw new SendMessageError('bad_request', 'Contact phone number not found', 400);
  }

  let apiKey = '';
  try {
    apiKey = decrypt(apiKeyEnc);
  } catch (err) {
    console.error('[send-message] no se pudo descifrar la api_key de Evolution:', err);
    throw new SendMessageError('whatsapp_not_configured', 'Credenciales de WhatsApp inválidas.', 400);
  }

  const evoCreds = { baseUrl, apiKey };
  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);
  let result:
    | Awaited<ReturnType<typeof evolutionSendText>>
    | Awaited<ReturnType<typeof evolutionSendMedia>>;

  if (isMediaKind) {
    if (!mediaUrl) {
      throw new SendMessageError('bad_request', 'Falta la URL del archivo multimedia', 400);
    }
    const kind: EvoMediaType = messageType === 'document' ? 'document' : (messageType as EvoMediaType);
    result = await evolutionSendMedia(evoCreds, instance, contact.phone, {
      type: kind,
      media: mediaUrl,
      caption: contentText || undefined,
      fileName: filename || undefined,
    });
  } else {
    result = await evolutionSendText(evoCreds, instance, contact.phone, contentText || '');
  }

  if (!result.ok) {
    console.error('[send-message] Evolution send failed:', result.error);
    throw new SendMessageError('meta_error', `Evolution API error: ${result.error}`, 502);
  }

  const waMessageId = result.data.messageId ?? `evo_${Date.now()}`;

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      sender_id: senderId ?? null,
      content_type: messageType,
      content_text: contentText || null,
      media_url: mediaUrl || null,
      template_name: null,
      message_id: waMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
      channel: 'whatsapp',
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting Evolution message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Evolution but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || '[...]',
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}

/**
 * Envío saliente por los canales de Meta (Instagram Direct / Facebook
 * Messenger).
 *
 * A diferencia de WhatsApp, aquí no hay teléfono: el hilo guarda el
 * `external_contact_id` (PSID/IGSID) del contacto y se envía por la
 * Send API de la página. Persiste el mensaje con su `channel` y pausa
 * los flujos activos, igual que los demás transportes. Soporta texto y
 * adjuntos por URL (imagen/vídeo/audio/archivo).
 */
async function sendMetaChannelMessage(
  db: SupabaseClient,
  accountId: string,
  params: {
    conversationId: string;
    channel: 'instagram' | 'facebook';
    contact: { id: string } | null;
    externalContactId: string | null;
    messageType: string;
    contentText?: string | null;
    mediaUrl?: string | null;
    senderId?: string | null;
    replyToMessageId?: string | null;
  }
): Promise<SendMessageResult> {
  const {
    conversationId,
    channel,
    contact,
    externalContactId,
    messageType,
    contentText,
    mediaUrl,
    senderId,
    replyToMessageId,
  } = params;

  if (!externalContactId) {
    throw new SendMessageError(
      'bad_request',
      'Falta el identificador del contacto en la plataforma',
      400
    );
  }

  const { data: row } = await db
    .from('channel_configs')
    .select('config, is_active')
    .eq('account_id', accountId)
    .eq('channel', channel)
    .maybeSingle();

  if (!row || !row.is_active) {
    throw new SendMessageError(
      'channel_inactive',
      `El canal ${channel} no está conectado`,
      400
    );
  }

  const config = (row.config ?? {}) as Record<string, unknown>;
  const pageId = typeof config.page_id === 'string' ? config.page_id : '';
  let accessToken = '';
  try {
    accessToken =
      typeof config.access_token === 'string' ? decrypt(config.access_token) : '';
  } catch (err) {
    console.error('[send-message] meta access_token decrypt failed:', err);
  }
  if (!pageId || !accessToken) {
    throw new SendMessageError(
      'channel_inactive',
      `Faltan credenciales del canal ${channel}`,
      400
    );
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);
  let sentMessageId = '';

  if (isMediaKind) {
    const kind = metaAttachmentType(messageType);
    if (!kind) {
      throw new SendMessageError(
        'bad_request',
        `Tipo de adjunto no soportado en ${channel}`,
        400
      );
    }
    if (!mediaUrl) {
      throw new SendMessageError('bad_request', 'Falta la URL del adjunto', 400);
    }
    const res = await sendMetaAttachment({
      pageId,
      accessToken,
      recipientId: externalContactId,
      kind,
      url: mediaUrl,
    });
    if (!res.ok) {
      console.error('[send-message] Meta attachment send failed:', res.error);
      throw new SendMessageError(
        'meta_error',
        `Error de ${channel}: ${res.error}`,
        502
      );
    }
    sentMessageId = res.data.messageId || `${channel}_${Date.now()}`;
  } else if (messageType === 'text') {
    const res = await sendMetaText({
      pageId,
      accessToken,
      recipientId: externalContactId,
      text: contentText || '',
    });
    if (!res.ok) {
      console.error('[send-message] Meta text send failed:', res.error);
      throw new SendMessageError(
        'meta_error',
        `Error de ${channel}: ${res.error}`,
        502
      );
    }
    sentMessageId = res.data.messageId || `${channel}_${Date.now()}`;
  } else {
    throw new SendMessageError(
      'bad_request',
      `Tipo de mensaje no soportado en ${channel}`,
      400
    );
  }

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      sender_id: senderId ?? null,
      content_type: messageType,
      content_text: contentText || null,
      media_url: mediaUrl || null,
      template_name: null,
      message_id: sentMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
      channel,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting Meta channel message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Mensaje enviado a ${channel} pero no se pudo guardar: ${msgError.message}`,
      500
    );
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  if (contact) {
    try {
      const { error: pauseErr } = await supabaseAdmin()
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .eq('status', 'active');
      if (pauseErr) {
        console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
      }
    } catch (err) {
      console.error(
        '[flows] pause-on-agent-send threw:',
        err instanceof Error ? err.message : err
      );
    }
  }

  return { messageId: messageRecord.id, whatsappMessageId: sentMessageId };
}
