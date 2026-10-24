import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  generateReply: vi.fn(),
  sendMessageToConversation: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    /** Agente activo de la cuenta (null = el motor cae al prompt global). */
    activeAgent: null as Record<string, unknown> | null,
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    /** Simula una base sin migración 072 (columna del lock ausente). */
    missingLockColumn: false,
  },
}))

/**
 * Build a generic PostgREST-style chain for mocks.
 * Every builder method returns itself; the chain is thenable via the
 * underlying `Promise` so callers can `await` the terminal method or
 * the chain directly.
 */
function pgChain(result: unknown = null, error: unknown = null) {
  const p = Promise.resolve({ data: result, error })
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    limit: () => p,               // SELECT-like terminal
    order: () => chain,
    maybeSingle: () => p,          // SELECT-like terminal
    then: p.then.bind(p),          // make the chain itself thenable
    catch: p.catch.bind(p),
  }
  return chain
}

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: h.sendMessageToConversation,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        return pgChain(h.state.autoResponders)
      }
      // Agentes de IA: el activo llega como lista (LIMIT 1).
      if (table === 'ai_agents') {
        return pgChain(h.state.activeAgent ? [h.state.activeAgent] : [])
      }
      // conversations
      return {
        select: (cols?: string) => {
          if (
            h.state.missingLockColumn &&
            typeof cols === 'string' &&
            cols.includes('ai_processing_at')
          ) {
            return pgChain(null, {
              code: '42703',
              message: 'column conversations.ai_processing_at does not exist',
            })
          }
          return pgChain(h.state.conv)
        },
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return pgChain({ id: 'locked' })
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    channel: 'whatsapp',
  }
  h.state.autoResponders = []
  h.state.activeAgent = null
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.missingLockColumn = false
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.sendMessageToConversation.mockResolvedValue({
    messageId: 'm1',
    whatsappMessageId: 'wamid-1',
  })
})

describe('dispatchInboundToAiReply — agente activo (A5)', () => {
  it('builds the prompt from the active agent, not the global one', async () => {
    h.state.activeAgent = {
      id: 'agent-1',
      channels: ['whatsapp'],
      objective: 'Reservar cita para el taller',
      behavior: 'Saluda y agenda',
      tone: ['cercano'],
      prohibited_rules: ['no promete precios'],
    }
    await dispatchInboundToAiReply(ARGS)
    const sys = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(sys).toContain('Objetivo:\nReservar cita para el taller')
    expect(sys).toContain('Tono: cercano')
    // No se filtran los metadatos del mock de conversación como agente.
    expect(sys).not.toContain('assigned_agent_id')
  })
})

describe('dispatchInboundToAiReply — sin agente activo (fallback)', () => {
  it('keeps the account-global prompt behavior', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalled()
    // El agente no se consultó (no hay filas) — el prompt no menciona
    // el encabezado de personalidad.
    const sys = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(sys).not.toContain('Objetivo:\nReservar')
  })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        contentText: 'Hello!',
        senderType: 'bot',
      }),
    )
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      channel: 'whatsapp',
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('resets disabled flag and proceeds when auto-reply was disabled', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      channel: 'whatsapp',
    }
    await dispatchInboundToAiReply(ARGS)
    // The disabled flag is reset at the top, so it proceeds to generate
    expect(h.generateReply).toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
      channel: 'whatsapp',
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — base sin migración 072', () => {
  it('responde aunque falte conversations.ai_processing_at', async () => {
    h.state.missingLockColumn = true
    h.state.conv = {
      assigned_agent_id: null,
      ai_reply_count: 0,
      channel: 'whatsapp',
    }

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalled()
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ conversationId: 'conv-1', senderType: 'bot' }),
    )
  })
})

describe('dispatchInboundToAiReply — canales del agente', () => {
  it('responde SMS cuando el agente eligió SMS', async () => {
    h.state.activeAgent = {
      id: 'agent-sms',
      channels: ['sms'],
      objective: 'Atender SMS',
      behavior: 'Responde breve',
      tone: [],
      prohibited_rules: [],
    }
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      channel: 'sms',
    }

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalled()
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        senderType: 'bot',
      }),
    )
  })

  it('no responde WhatsApp si el agente solo eligió SMS', async () => {
    h.state.activeAgent = {
      id: 'agent-sms',
      channels: ['sms'],
      objective: 'Atender SMS',
      behavior: null,
      tone: [],
      prohibited_rules: [],
    }

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('sin agente activo, el prompt global no responde SMS', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      channel: 'sms',
    }

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('sin agente activo, el prompt global no responde Instagram', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      channel: 'instagram',
    }

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('un agente antiguo sin channels conserva WhatsApp', async () => {
    h.state.activeAgent = {
      id: 'agent-legacy',
      objective: 'Atención',
      behavior: null,
      tone: [],
      prohibited_rules: [],
    }

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalled()
    expect(h.sendMessageToConversation).toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toEqual({ ai_autoreply_disabled: true, ai_processing_at: null })
    expect(h.state.rpcCalls).toHaveLength(0)
  })
})
