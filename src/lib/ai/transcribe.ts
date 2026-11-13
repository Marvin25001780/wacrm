// ============================================================
// Transcripción de notas de voz para el motor de IA.
//
// El bot solo recibe `messages.content_text`, así que un audio sin
// texto nunca llegaba al modelo y el hilo se quedaba mudo. Esta capa
// transcribe el último audio entrante del hilo antes de construir el
// contexto y guarda el texto en `content_text` — la misma columna que
// ya leen la IA y la burbuja del chat, así que no hace falta migración.
//
// Cubre OpenAI y Groq (endpoint de audio compatible con OpenAI) y
// Gemini (audio inline en generateContent). Anthropic y DeepSeek no
// exponen transcripción: se devuelve `null` y el diagnóstico de
// Ajustes → Asistente de IA explica el motivo.
//
// Habla con el proveedor aunque la IA esté APAGADA: transcribir es una
// función de datos para la bandeja, no de respuesta automática.
//
// Todo es best-effort: un fallo de descarga o del proveedor se
// registra y se devuelve `null`; nunca tumba el webhook ni la
// respuesta del bot.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'
import {
  evolutionGetBase64Media,
  evoInstanceName,
} from '@/lib/channels/evolution'

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions'
const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models'

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini-transcribe'
const OPENAI_FALLBACK_MODEL = 'whisper-1'
const GROQ_DEFAULT_MODEL = 'whisper-large-v3-turbo'
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'
const GEMINI_PROMPT =
  'Transcribe literalmente esta nota de voz. Devuelve solo el texto hablado, sin comentarios, etiquetas ni formato.'

const TRANSCRIBE_TIMEOUT_MS = 60_000
/** OpenAI rechaza archivos de más de 25 MB; nos quedamos por debajo. */
const MAX_AUDIO_BYTES = 24 * 1024 * 1024

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
}

export type TranscriptionProvider = 'openai' | 'groq' | 'gemini'

/**
 * Configuración mínima para transcribir. Se carga aparte de
 * `loadAiConfig` porque esa función devuelve `null` con el interruptor
 * maestro apagado, y la transcripción debe funcionar igual.
 */
export interface TranscriptionConfig {
  provider: string
  model?: string | null
  apiKey: string
}

export class TranscriptionError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'TranscriptionError'
    this.status = status
  }
}

/** Proveedor de chat con endpoint de transcripción compatible. */
export function transcriptionProvider(
  provider: string,
): TranscriptionProvider | null {
  if (provider === 'openai' || provider === 'groq' || provider === 'gemini') {
    return provider
  }
  return null
}

export function transcriptionModel(provider: TranscriptionProvider): string {
  if (provider === 'groq') return GROQ_DEFAULT_MODEL
  if (provider === 'gemini') return GEMINI_DEFAULT_MODEL
  return OPENAI_DEFAULT_MODEL
}

/**
 * Lee el proveedor y la clave del negocio SIN exigir `is_active`.
 * `loadAiConfig` (config.ts) devuelve `null` cuando el asistente está
 * apagado; eso es correcto para responder, pero dejaba sin
 * transcripción a los audios de un negocio con la IA en pausa.
 */
export async function loadTranscriptionConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<TranscriptionConfig | null> {
  const { data, error } = await db
    .from('ai_configs')
    .select('provider, model, api_key')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error || !data) return null

  const row = data as {
    provider?: string
    model?: string | null
    api_key?: string | null
  }
  if (!row.provider || !row.api_key) return null

  try {
    return {
      provider: row.provider,
      model: row.model ?? null,
      apiKey: decrypt(row.api_key),
    }
  } catch {
    console.warn('[transcribe] no se pudo descifrar la clave de IA')
    return null
  }
}

/** Extensión que espera cada endpoint, derivada del MIME de WhatsApp. */
export function audioFilename(
  mimeType: string | null | undefined,
  fallback = 'audio',
): string {
  const base = (mimeType ?? '').split(';')[0].trim().toLowerCase()
  const ext = AUDIO_EXTENSIONS[base] ?? 'ogg'
  return `${fallback}.${ext}`
}

export interface AudioBytes {
  buffer: Buffer
  mimeType: string
  filename: string
}

interface TranscribeArgs {
  provider: TranscriptionProvider
  apiKey: string
  model?: string
  buffer: Buffer
  mimeType: string
  filename: string
  /** Inyectable en pruebas. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * Envía el audio al endpoint de transcripción y devuelve el texto.
 *
 * Para OpenAI probamos primero `gpt-4o-mini-transcribe` (más barato y
 * preciso) y, si el proveedor lo rechaza por modelo no disponible,
 * repetimos con `whisper-1`. Groq usa `whisper-large-v3-turbo` y no
 * tiene fallback.
 */
export async function transcribeAudio(args: TranscribeArgs): Promise<string> {
  const {
    provider,
    apiKey,
    model,
    buffer,
    mimeType,
    filename,
    fetchImpl = fetch,
    timeoutMs = TRANSCRIBE_TIMEOUT_MS,
  } = args

  if (buffer.byteLength === 0) {
    throw new TranscriptionError('El audio está vacío', 400)
  }
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    throw new TranscriptionError('El audio supera los 24 MB', 413)
  }

  if (provider === 'gemini') {
    return transcribeWithGemini({
      apiKey,
      model: model?.trim() || transcriptionModel('gemini'),
      buffer,
      mimeType,
      fetchImpl,
      timeoutMs,
    })
  }

  const url =
    provider === 'groq' ? GROQ_TRANSCRIBE_URL : OPENAI_TRANSCRIBE_URL
  const primary = model?.trim() || transcriptionModel(provider)
  const models =
    provider === 'openai' && primary !== OPENAI_FALLBACK_MODEL
      ? [primary, OPENAI_FALLBACK_MODEL]
      : [primary]

  let lastError: unknown = null

  for (const candidate of models) {
    try {
      return await callTranscription({
        url,
        apiKey,
        model: candidate,
        buffer,
        mimeType,
        filename,
        fetchImpl,
        timeoutMs,
      })
    } catch (err) {
      lastError = err
      // Solo vale la pena probar el modelo de respaldo cuando el
      // proveedor dice que ese modelo no existe o no está disponible.
      if (
        !(err instanceof TranscriptionError) ||
        (err.status !== 400 && err.status !== 404) ||
        candidate === models[models.length - 1]
      ) {
        throw err
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new TranscriptionError('No se pudo transcribir el audio')
}

async function callTranscription(args: {
  url: string
  apiKey: string
  model: string
  buffer: Buffer
  mimeType: string
  filename: string
  fetchImpl: typeof fetch
  timeoutMs: number
}): Promise<string> {
  const { url, apiKey, model, buffer, mimeType, filename, fetchImpl, timeoutMs } =
    args

  const form = new FormData()
  form.append('model', model)
  form.append('response_format', 'json')
  form.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    filename,
  )

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError'
    throw new TranscriptionError(
      timedOut
        ? 'La transcripción tardó demasiado'
        : err instanceof Error
          ? err.message
          : 'No se pudo conectar con el proveedor de transcripción',
      timedOut ? 504 : 502,
    )
  } finally {
    clearTimeout(timeout)
  }

  const raw = await response.text().catch(() => '')
  if (!response.ok) {
    throw new TranscriptionError(
      `El proveedor rechazó el audio (${response.status}): ${raw.slice(0, 300)}`,
      response.status,
    )
  }

  let text = raw
  try {
    const parsed = JSON.parse(raw) as { text?: unknown }
    if (typeof parsed.text === 'string') text = parsed.text
  } catch {
    // `response_format=json` siempre responde JSON, pero si un proxy
    // devuelve texto plano lo aceptamos igual.
  }

  return text.trim()
}

/**
 * Gemini acepta el audio inline en `generateContent`, así que no hace
 * falta un endpoint de transcripción aparte. Se usa el modelo de chat
 * del negocio (p. ej. `gemini-3.5-flash-lite`) o el de respaldo.
 */
async function transcribeWithGemini(args: {
  apiKey: string
  model: string
  buffer: Buffer
  mimeType: string
  fetchImpl: typeof fetch
  timeoutMs: number
}): Promise<string> {
  const { apiKey, model, buffer, mimeType, fetchImpl, timeoutMs } = args
  const bareModel = model.replace(/^models\//, '')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetchImpl(
      `${GEMINI_BASE_URL}/${encodeURIComponent(bareModel)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: GEMINI_PROMPT },
                {
                  inlineData: {
                    mimeType,
                    data: buffer.toString('base64'),
                  },
                },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
        signal: controller.signal,
      },
    )
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError'
    throw new TranscriptionError(
      timedOut
        ? 'La transcripción tardó demasiado'
        : err instanceof Error
          ? err.message
          : 'No se pudo conectar con Gemini',
      timedOut ? 504 : 502,
    )
  } finally {
    clearTimeout(timeout)
  }

  const raw = await response.text().catch(() => '')
  if (!response.ok) {
    throw new TranscriptionError(
      `Gemini rechazó el audio (${response.status}): ${raw.slice(0, 300)}`,
      response.status,
    )
  }

  let parsed: {
    candidates?: {
      content?: { parts?: { text?: unknown; thought?: unknown }[] }
    }[]
  }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new TranscriptionError('Gemini devolvió una respuesta inválida', 502)
  }

  const parts = parsed.candidates?.[0]?.content?.parts ?? []
  return parts
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ruta del objeto dentro del bucket a partir de su URL guardada. */
export function storagePathFromUrl(url: string): string | null {
  if (!url.startsWith('http')) return null
  const marker = '/chat-media/'
  const index = url.indexOf(marker)
  if (index === -1) return null

  const raw = url.slice(index + marker.length).split('?')[0].split('#')[0]
  if (!raw) return null

  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

interface ConversationMediaRow {
  account_id: string
  channel: string | null
  whatsapp_config_id: string | null
  external_contact_id?: string | null
}

/**
 * Descarga los bytes del audio desde donde los haya dejado la ingesta:
 * el bucket privado `chat-media` (Meta, ya espejado), una URL http
 * directa, el proxy de Meta, o —como último recurso— la API de
 * Evolution, que puede resolver los audios cifrados de WhatsApp a
 * partir del id del mensaje.
 */
export async function loadAudioBytes(
  db: SupabaseClient,
  mediaUrl: string | null,
  mediaType: string | null,
  conversation: ConversationMediaRow,
  messageId: string | null = null,
): Promise<AudioBytes | null> {
  const mimeType = (mediaType ?? 'audio/ogg').split(';')[0].trim()
  const filename = audioFilename(mimeType)

  if (mediaUrl) {
    // 1) Copia durable en `chat-media` (Meta, migración 065).
    const path = storagePathFromUrl(mediaUrl)
    if (path) {
      const { data, error } = await db.storage.from('chat-media').download(path)
      if (!error && data) {
        return {
          buffer: Buffer.from(await data.arrayBuffer()),
          mimeType,
          filename,
        }
      }
      console.warn('[transcribe] no se pudo leer chat-media:', error?.message)
    } else if (mediaUrl.startsWith('http')) {
      // 2) URL http directa (Evolution u otro canal que la exponga).
      const direct = await fetchAudio(mediaUrl, mimeType, filename)
      if (direct) return direct
    } else if (mediaUrl.startsWith('/api/whatsapp/media/')) {
      // 3) Proxy de Meta: necesita el token de la línea del hilo.
      const mediaId = mediaUrl.split('/').filter(Boolean).pop()
      if (mediaId) {
        const token = await loadWhatsappConfig(db, conversation)
        if (token) {
          try {
            const info = await getMediaUrl({ mediaId, accessToken: token })
            const downloaded = await downloadMedia({
              downloadUrl: info.url,
              accessToken: token,
            })
            return {
              buffer: downloaded.buffer,
              mimeType: (downloaded.contentType || mimeType).split(';')[0].trim(),
              filename: audioFilename(downloaded.contentType || mimeType),
            }
          } catch (err) {
            console.warn(
              '[transcribe] no se pudo descargar el audio de Meta:',
              err instanceof Error ? err.message : err,
            )
          }
        }
      }
    }
  }

  // 4) Evolution: sus audios suelen llegar sin URL descargable
  //    (`audioMessage.url` va cifrada). La instancia sí puede
  //    devolver el base64 a partir del id del mensaje.
  return loadEvolutionAudio(
    db,
    conversation.account_id,
    messageId,
    conversation.external_contact_id ?? null,
    mimeType,
  )
}

async function loadEvolutionAudio(
  db: SupabaseClient,
  accountId: string,
  messageId: string | null,
  remotePhone: string | null,
  mimeType: string,
): Promise<AudioBytes | null> {
  if (!messageId) return null

  const { data } = await db
    .from('channel_configs')
    .select('config, is_active')
    .eq('account_id', accountId)
    .eq('channel', 'evolution')
    .maybeSingle()

  const row = data as
    | { config?: Record<string, unknown>; is_active?: boolean }
    | null
  if (!row || !row.is_active) return null

  const config = row.config ?? {}
  const baseUrl = typeof config.base_url === 'string' ? config.base_url : ''
  const encrypted = typeof config.api_key === 'string' ? config.api_key : ''
  if (!baseUrl || !encrypted) return null

  const instance =
    typeof config.instance === 'string' && config.instance
      ? config.instance
      : evoInstanceName(accountId)

  let apiKey: string
  try {
    apiKey = decrypt(encrypted)
  } catch {
    console.warn('[transcribe] no se pudo descifrar la clave de Evolution')
    return null
  }

  const digits = (remotePhone ?? '').replace(/\D/g, '')
  const media = await evolutionGetBase64Media(
    { baseUrl, apiKey },
    instance,
    messageId,
    digits ? `${digits}@s.whatsapp.net` : null,
  )
  if (!media) return null

  const buffer = Buffer.from(media.base64, 'base64')
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_AUDIO_BYTES) return null

  const resolved = (media.mimetype || mimeType).split(';')[0].trim()
  return {
    buffer,
    mimeType: resolved,
    filename: audioFilename(resolved),
  }
}

async function loadWhatsappConfig(
  db: SupabaseClient,
  conversation: ConversationMediaRow,
): Promise<string | null> {
  const query = db
    .from('whatsapp_config')
    .select('access_token')
    .eq('account_id', conversation.account_id)

  const { data } = conversation.whatsapp_config_id
    ? await query.eq('id', conversation.whatsapp_config_id).maybeSingle()
    : await query.limit(1).maybeSingle()

  const encrypted = (data as { access_token?: string } | null)?.access_token
  if (!encrypted) return null

  try {
    return decrypt(encrypted)
  } catch {
    console.warn('[transcribe] no se pudo descifrar el token de WhatsApp')
    return null
  }
}

async function fetchAudio(
  url: string,
  mimeType: string,
  filename: string,
): Promise<AudioBytes | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength > MAX_AUDIO_BYTES) return null
    return { buffer, mimeType, filename }
  } catch (err) {
    console.warn(
      '[transcribe] no se pudo descargar el audio:',
      err instanceof Error ? err.message : err,
    )
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * ¿El último mensaje del hilo es una nota de voz del cliente que sigue
 * sin texto? Se consulta DESPUÉS de intentar transcribir: si el audio
 * quedó sin transcribir (proveedor sin audio, Evolution sin URL, fallo
 * del proveedor), el modelo no tiene nada que leer y contestar sería
 * responderle al mensaje anterior, no al cliente.
 *
 * Un audio viejo que falló no bloquea: solo cuenta si es el último.
 */
export async function lastMessageIsUntranscribedAudio(
  db: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  try {
    const { data } = await db
      .from('messages')
      .select('sender_type, content_type, content_text')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const row = data as {
      sender_type?: string
      content_type?: string
      content_text?: string | null
    } | null

    return Boolean(
      row &&
        row.sender_type === 'customer' &&
        row.content_type === 'audio' &&
        !row.content_text?.trim(),
    )
  } catch {
    // Ante la duda, no bloqueamos al bot.
    return false
  }
}

/**
 * Transcribe el último audio entrante sin texto de la conversación y
 * guarda el resultado en `messages.content_text`.
 *
 * Devuelve el texto (o `null` si no había audio, el proveedor no
 * transcribe o algo falló). No lanza.
 */
export async function ensureAudioTranscript(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  config: TranscriptionConfig,
): Promise<string | null> {
  const provider = transcriptionProvider(config.provider)
  if (!provider) return null

  try {
    const { data: conversation, error: convError } = await db
      .from('conversations')
      .select('account_id, channel, whatsapp_config_id, external_contact_id')
      .eq('id', conversationId)
      .maybeSingle()

    if (convError || !conversation) return null

    const { data: audio, error: audioError } = await db
      .from('messages')
      .select('id, media_url, media_type, message_id, created_at')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .eq('content_type', 'audio')
      .is('content_text', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (audioError || !audio) return null

    const row = audio as {
      id: string
      media_url: string | null
      media_type: string | null
      message_id: string | null
      created_at: string
    }

    const bytes = await loadAudioBytes(
      db,
      row.media_url,
      row.media_type,
      conversation as ConversationMediaRow,
      row.message_id,
    )
    if (!bytes) return null

    const text = await transcribeAudio({
      provider,
      apiKey: config.apiKey,
      model: config.model ?? undefined,
      buffer: bytes.buffer,
      mimeType: bytes.mimeType,
      filename: bytes.filename,
    })

    if (!text) return null

    const { error: updateError } = await db
      .from('messages')
      .update({ content_text: text })
      .eq('id', row.id)

    if (updateError) {
      console.error('[transcribe] no se pudo guardar la transcripción:', updateError)
      return null
    }

    // Si era el último mensaje del hilo, el resumen de la bandeja
    // también deja de decir "[audio]".
    const { data: latest } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if ((latest as { id?: string } | null)?.id === row.id) {
      await db
        .from('conversations')
        .update({ last_message_text: text })
        .eq('id', conversationId)
    }

    console.info(
      `[transcribe] audio transcrito (${provider}) conversacion=${conversationId} caracteres=${text.length}`,
    )
    return text
  } catch (err) {
    console.warn(
      '[transcribe] no se pudo transcribir el audio:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
