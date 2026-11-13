import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  audioFilename,
  ensureAudioTranscript,
  lastMessageIsUntranscribedAudio,
  storagePathFromUrl,
  transcribeAudio,
  transcriptionProvider,
} from './transcribe'
import type { AiConfig } from './types'

// La clave de Evolution llega cifrada en producción. En esta prueba el
// mock la devuelve tal cual para no depender de ENCRYPTION_KEY.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => value,
  encrypt: (value: string) => value,
}))

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('transcriptionProvider', () => {
  it('accepts the providers that expose audio transcription', () => {
    expect(transcriptionProvider('openai')).toBe('openai')
    expect(transcriptionProvider('groq')).toBe('groq')
    expect(transcriptionProvider('gemini')).toBe('gemini')
    expect(transcriptionProvider('anthropic')).toBeNull()
    expect(transcriptionProvider('deepseek')).toBeNull()
  })
})

describe('audioFilename', () => {
  it('maps WhatsApp voice notes (ogg/opus) to .ogg', () => {
    expect(audioFilename('audio/ogg; codecs=opus')).toBe('audio.ogg')
    expect(audioFilename('audio/mpeg')).toBe('audio.mp3')
  })

  it('falls back to .ogg for an unknown audio MIME', () => {
    expect(audioFilename(null)).toBe('audio.ogg')
    expect(audioFilename('audio/x-unknown')).toBe('audio.ogg')
  })
})

describe('storagePathFromUrl', () => {
  it('extracts and decodes the chat-media object path', () => {
    expect(
      storagePathFromUrl(
        'https://proj.supabase.co/storage/v1/object/public/chat-media/account-1/inbound/a%20b.ogg',
      ),
    ).toBe('account-1/inbound/a b.ogg')
  })

  it('ignores non-storage URLs', () => {
    expect(storagePathFromUrl('https://cdn.example.com/a.ogg')).toBeNull()
    expect(storagePathFromUrl('/api/whatsapp/media/123')).toBeNull()
  })
})

describe('transcribeAudio', () => {
  it('posts the audio to OpenAI with the configured key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: '  Hola, ¿tienen stock?  ' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeAudio({
      provider: 'openai',
      apiKey: 'sk-test',
      buffer: Buffer.from('audio-bytes'),
      mimeType: 'audio/ogg',
      filename: 'audio.ogg',
    })

    expect(text).toBe('Hola, ¿tienen stock?')

    const [[url, init]] = fetchMock.mock.calls as unknown as [
      string,
      RequestInit,
    ][]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-test',
    )
    const form = init.body as FormData
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('retries with whisper-1 when OpenAI does not know the default model', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('model not found', { status: 404 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: 'contenido' }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeAudio({
      provider: 'openai',
      apiKey: 'sk-test',
      buffer: Buffer.from('audio-bytes'),
      mimeType: 'audio/ogg',
      filename: 'audio.ogg',
    })

    expect(text).toBe('contenido')
    const models = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(
      ([, init]) => (init.body as FormData).get('model'),
    )
    expect(models).toEqual(['gpt-4o-mini-transcribe', 'whisper-1'])
  })

  it('does not retry a hard provider failure', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      transcribeAudio({
        provider: 'openai',
        apiKey: 'sk-test',
        buffer: Buffer.from('audio-bytes'),
        mimeType: 'audio/ogg',
        filename: 'audio.ogg',
      }),
    ).rejects.toThrow(/500/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the Groq endpoint and model', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: 'ok' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await transcribeAudio({
      provider: 'groq',
      apiKey: 'gsk-test',
      buffer: Buffer.from('audio-bytes'),
      mimeType: 'audio/ogg',
      filename: 'audio.ogg',
    })

    const [[url, init]] = fetchMock.mock.calls as unknown as [
      string,
      RequestInit,
    ][]
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect((init.body as FormData).get('model')).toBe('whisper-large-v3-turbo')
  })

  it('sends the audio inline to Gemini and joins the response parts', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: 'Hola, ' }, { text: 'quiero dos camisas' }] } },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeAudio({
      provider: 'gemini',
      apiKey: 'AIza-test',
      model: 'gemini-3.5-flash-lite',
      buffer: Buffer.from('audio-bytes'),
      mimeType: 'audio/ogg',
      filename: 'audio.ogg',
    })

    expect(text).toBe('Hola, quiero dos camisas')

    const [[url, init]] = fetchMock.mock.calls as unknown as [
      string,
      RequestInit,
    ][]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    )
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'AIza-test',
    )
    const body = JSON.parse(String(init.body)) as {
      contents: { parts: { inlineData?: { mimeType: string; data: string } }[] }[]
    }
    const inline = body.contents[0].parts[1].inlineData
    expect(inline?.mimeType).toBe('audio/ogg')
    expect(Buffer.from(inline?.data ?? '', 'base64').toString()).toBe(
      'audio-bytes',
    )
  })
})

describe('lastMessageIsUntranscribedAudio', () => {
  function dbWith(row: unknown): SupabaseClient {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: row, error: null }),
    }
    return { from: () => builder } as unknown as SupabaseClient
  }

  it('detecta una nota de voz del cliente todavía sin texto', async () => {
    expect(
      await lastMessageIsUntranscribedAudio(
        dbWith({
          sender_type: 'customer',
          content_type: 'audio',
          content_text: null,
        }),
        'conv-1',
      ),
    ).toBe(true)
  })

  it('no bloquea cuando el audio ya tiene transcripción', async () => {
    expect(
      await lastMessageIsUntranscribedAudio(
        dbWith({
          sender_type: 'customer',
          content_type: 'audio',
          content_text: 'Hola, quiero dos camisas',
        }),
        'conv-1',
      ),
    ).toBe(false)
  })

  it('no bloquea cuando el último mensaje es de texto o del bot', async () => {
    expect(
      await lastMessageIsUntranscribedAudio(
        dbWith({
          sender_type: 'customer',
          content_type: 'text',
          content_text: 'hola',
        }),
        'conv-1',
      ),
    ).toBe(false)
    expect(
      await lastMessageIsUntranscribedAudio(
        dbWith({
          sender_type: 'bot',
          content_type: 'audio',
          content_text: null,
        }),
        'conv-1',
      ),
    ).toBe(false)
  })
})

describe('ensureAudioTranscript', () => {
  it('does nothing when the provider has no transcription endpoint', async () => {
    const db = {
      from: () => {
        throw new Error('no debería consultar la base')
      },
    } as unknown as SupabaseClient

    const text = await ensureAudioTranscript(
      db,
      'acct-1',
      'conv-1',
      aiConfig({ provider: 'anthropic' }),
    )

    expect(text).toBeNull()
  })

  it('stores the transcript and refreshes the inbox preview', async () => {
    const updates: { table: string; payload: Record<string, unknown> }[] = []
    const audio = {
      id: 'msg-1',
      media_url:
        'https://proj.supabase.co/storage/v1/object/public/chat-media/account-1/inbound/a.ogg',
      media_type: 'audio/ogg; codecs=opus',
      created_at: '2026-11-12T10:00:00.000Z',
    }

    function chain(table: string): unknown {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({
          data:
            table === 'conversations'
              ? {
                  account_id: 'acct-1',
                  channel: 'whatsapp',
                  whatsapp_config_id: null,
                }
              : audio,
          error: null,
        }),
        update: (payload: Record<string, unknown>) => {
          updates.push({ table, payload })
          return { eq: async () => ({ error: null }) }
        },
      }
      return builder
    }

    const db = {
      from: chain,
      storage: {
        from: () => ({
          download: async () => ({
            data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/ogg' }),
            error: null,
          }),
        }),
      },
    } as unknown as SupabaseClient

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ text: 'Quiero dos camisas' }), {
          status: 200,
        }),
      ),
    )

    const text = await ensureAudioTranscript(
      db,
      'acct-1',
      'conv-1',
      aiConfig(),
    )

    expect(text).toBe('Quiero dos camisas')
    expect(updates).toContainEqual({
      table: 'messages',
      payload: { content_text: 'Quiero dos camisas' },
    })
    expect(updates).toContainEqual({
      table: 'conversations',
      payload: { last_message_text: 'Quiero dos camisas' },
    })
  })

  it('baja el audio de Evolution cuando el mensaje no trae URL', async () => {
    const updates: { table: string; payload: Record<string, unknown> }[] = []
    const audio = {
      id: 'msg-2',
      media_url: null,
      media_type: 'audio/ogg',
      message_id: 'wamid-evo-1',
      created_at: '2026-11-12T11:00:00.000Z',
    }

    function chain(table: string): unknown {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (table === 'conversations') {
            return {
              data: {
                account_id: 'acct-1',
                channel: 'whatsapp',
                whatsapp_config_id: null,
                external_contact_id: '584241234567',
              },
              error: null,
            }
          }
          if (table === 'channel_configs') {
            return {
              data: {
                is_active: true,
                config: {
                  base_url: 'https://evo.test',
                  instance: 'nexus-acct',
                  api_key: 'evo-key',
                },
              },
              error: null,
            }
          }
          return { data: audio, error: null }
        },
        update: (payload: Record<string, unknown>) => {
          updates.push({ table, payload })
          return { eq: async () => ({ error: null }) }
        },
      }
      return builder
    }

    const db = {
      from: chain,
      storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) },
    } as unknown as SupabaseClient

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url)
      if (href.includes('/chat/getBase64FromMediaMessage/')) {
        return new Response(
          JSON.stringify({
            base64: Buffer.from('audio-bytes').toString('base64'),
            mimetype: 'audio/ogg; codecs=opus',
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ text: 'Audio de Evolution' }), {
        status: 200,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await ensureAudioTranscript(
      db,
      'acct-1',
      'conv-1',
      aiConfig(),
    )

    expect(text).toBe('Audio de Evolution')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/chat/getBase64FromMediaMessage/nexus-acct'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(updates).toContainEqual({
      table: 'messages',
      payload: { content_text: 'Audio de Evolution' },
    })
  })
})
