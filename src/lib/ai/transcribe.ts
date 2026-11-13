// ============================================================
// Transcripción de notas de voz para el motor de IA.
//
// El bot solo recibe `messages.content_text`, así que un audio sin
// texto nunca llegaba al modelo y el hilo se quedaba mudo. Esta capa
// transcribe el último audio entrante del hilo antes de construir el
// contexto y guarda el texto en `content_text` — la misma columna que
// ya leen la IA y la burbuja del chat, así que no hace falta migración.
//
// Solo se transcribe cuando el proveedor de IA del negocio tiene
// endpoint de audio compatible con OpenAI: OpenAI y Groq. Con
// Anthropic, Gemini o DeepSeek se devuelve `null` y el diagnóstico de
// Ajustes → Asistente de IA explica el motivo.
//
// Todo es best-effort: un fallo de descarga o del proveedor se
// registra y se devuelve `null`; nunca tumba el webhook ni la
// respuesta del bot.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'
import type { AiConfig } from './types'

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions'
const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini-transcribe'
const OPENAI_FALLBACK_MODEL = 'whisper-1'
const GROQ_DEFAULT_MODEL = 'whisper-large-v3-turbo'

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

export type TranscriptionProvider = 'openai' | 'groq'

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
  if (provider === 'openai' || provider === 'groq') return provider
  return null
}

export function transcriptionModel(provider: TranscriptionProvider): string {
  return provider === 'groq' ? GROQ_DEFAULT_MODEL : OPENAI_DEFAULT_MODEL
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
}

/**
 * Descarga los bytes del audio desde donde los haya dejado la ingesta:
 * el bucket privado `chat-media` (Meta, ya espejado), una URL http
 * directa (Evolution cuando la incluye) o el proxy de Meta.
 */
export async function loadAudioBytes(
  db: SupabaseClient,
  mediaUrl: string | null,
  mediaType: string | null,
  conversation: ConversationMediaRow,
): Promise<AudioBytes | null> {
  if (!mediaUrl) return null

  const mimeType = (mediaType ?? 'audio/ogg').split(';')[0].trim()
  const filename = audioFilename(mimeType)

  // 1) Copia durable en `chat-media` (Meta, migración 065).
  const path = storagePathFromUrl(mediaUrl)
  if (path) {
    const { data, error } = await db.storage.from('chat-media').download(path)
    if (error || !data) {
      console.warn('[transcribe] no se pudo leer chat-media:', error?.message)
      return null
    }
    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      mimeType,
      filename,
    }
  }

  // 2) URL http directa (Evolution u otro canal que la exponga).
  if (mediaUrl.startsWith('http')) {
    return fetchAudio(mediaUrl, mimeType, filename)
  }

  // 3) Proxy de Meta: /api/whatsapp/media/<mediaId>. Necesita el token
  //    de la línea del hilo para volver a pedirle la URL a Meta.
  if (mediaUrl.startsWith('/api/whatsapp/media/')) {
    const mediaId = mediaUrl.split('/').filter(Boolean).pop()
    if (!mediaId) return null

    const config = await loadWhatsappConfig(db, conversation)
    if (!config) return null

    try {
      const info = await getMediaUrl({ mediaId, accessToken: config })
      const downloaded = await downloadMedia({
        downloadUrl: info.url,
        accessToken: config,
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
      return null
    }
  }

  return null
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
  config: AiConfig,
): Promise<string | null> {
  const provider = transcriptionProvider(config.provider)
  if (!provider) return null

  try {
    const { data: conversation, error: convError } = await db
      .from('conversations')
      .select('account_id, channel, whatsapp_config_id')
      .eq('id', conversationId)
      .maybeSingle()

    if (convError || !conversation) return null

    const { data: audio, error: audioError } = await db
      .from('messages')
      .select('id, media_url, media_type, created_at')
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
      created_at: string
    }

    const bytes = await loadAudioBytes(
      db,
      row.media_url,
      row.media_type,
      conversation as ConversationMediaRow,
    )
    if (!bytes) return null

    const text = await transcribeAudio({
      provider,
      apiKey: config.apiKey,
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
