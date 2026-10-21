import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  generateReply: vi.fn(),
  loadAgentKnowledge: vi.fn(),
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('./knowledge', () => ({ loadAgentKnowledge: h.loadAgentKnowledge }))

import { AgentTurnError, runAgentTurn } from './agent-turn'
import type { AiAgentRow } from './agent-prompt'

const agent = {
  id: 'ag-1',
  account_id: 'acc-1',
  name: 'Agente QA',
  description: null,
  status: 'active',
  objective: 'Resolver dudas',
  behavior: null,
  tone: ['amable'],
  prohibited_rules: [],
  action_tags: false,
  action_fields: false,
  action_assign: false,
  action_close: false,
  action_notes: false,
  exit_message: null,
  response_quality: 'balanced',
  max_reply_buttons: 2,
  max_reminders: 2,
  follow_up_delay_minutes: 30,
} as unknown as AiAgentRow

const config = {
  provider: 'groq',
  model: 'llama-3.3-70b-versatile',
  apiKey: 'k',
  systemPrompt: null,
  isActive: true,
  autoReplyEnabled: true,
  autoReplyMaxPerConversation: 3,
  fallbackModel: null,
}

const db = {} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.loadAiConfig.mockResolvedValue(config)
  h.loadAgentKnowledge.mockResolvedValue({ blocks: [], qa: [], loaded: false })
  h.generateReply.mockResolvedValue({ text: 'Hola', handoff: false })
})

describe('runAgentTurn — errores de configuración', () => {
  it('llave indescifrable se reporta como ai_key_unreadable, no como 500', async () => {
    h.loadAiConfig.mockRejectedValue(
      new Error('Encrypted token has unrecognised format (expected 1 or 2 colons, got 0)'),
    )

    await expect(
      runAgentTurn(db, agent, [{ role: 'user', content: 'hola' }], { execute: false }),
    ).rejects.toMatchObject({ name: 'AgentTurnError', code: 'ai_key_unreadable' })
  })

  it('sin proveedor configurado sigue siendo ai_not_configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)

    const err = await runAgentTurn(db, agent, [{ role: 'user', content: 'hola' }], {
      execute: false,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AgentTurnError)
    expect((err as AgentTurnError).code).toBe('ai_not_configured')
  })
})

describe('runAgentTurn — conocimiento y acciones', () => {
  it('inyecta las fuentes y Q&A en el prompt del sistema', async () => {
    h.loadAgentKnowledge.mockResolvedValue({
      blocks: ['Lista de precios\nConsulta 30 USD'],
      qa: [{ question: '¿Cuánto vale?', answer: '30 USD' }],
      loaded: true,
    })

    const res = await runAgentTurn(db, agent, [{ role: 'user', content: '¿Cuánto vale?' }], {
      execute: false,
    })

    expect(res.knowledgeLoaded).toBe(true)
    const prompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(prompt).toContain('Consulta 30 USD')
    expect(prompt).toContain('30 USD')
  })

  it('solo reporta acciones (sin contacto real no las aplica)', async () => {
    h.generateReply.mockResolvedValue({
      text: '{"reply":"Te agendo","actions":[{"type":"add_tag","value":"VIP"}]}',
      handoff: false,
    })

    const res = await runAgentTurn(db, { ...agent, action_tags: true }, [
      { role: 'user', content: 'quiero cita' },
    ])

    expect(res.reply).toBe('Te agendo')
    expect(res.actions).toEqual(['add_tag'])
    expect(res.applied).toBeUndefined()
  })
})
