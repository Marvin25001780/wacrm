import { describe, expect, it } from 'vitest'

import {
  agentChannels,
  agentRespondsOn,
  normalizeAiAgentChannels,
  normalizeConversationChannel,
} from './channels'

describe('canales del agente de IA', () => {
  it('descarta valores desconocidos, duplicados y respeta el orden', () => {
    expect(
      normalizeAiAgentChannels([
        'sms',
        'tiktok',
        'whatsapp',
        'sms',
        'facebook',
      ]),
    ).toEqual(['whatsapp', 'sms', 'facebook'])
  })

  it('interpreta una fila antigua sin channels como WhatsApp', () => {
    expect(agentChannels(undefined)).toEqual(['whatsapp'])
    expect(agentChannels([])).toEqual(['whatsapp'])
    expect(agentChannels(['instagram'])).toEqual(['instagram'])
  })

  it('solo responde en un canal seleccionado', () => {
    const agent = { channels: ['whatsapp', 'sms'] }
    expect(agentRespondsOn(agent, 'whatsapp')).toBe(true)
    expect(agentRespondsOn(agent, 'sms')).toBe(true)
    expect(agentRespondsOn(agent, 'instagram')).toBe(false)
    expect(agentRespondsOn(agent, 'email')).toBe(false)
  })

  it('normaliza el canal del hilo y excluye canales sin integración', () => {
    expect(normalizeConversationChannel(null)).toBe('whatsapp')
    expect(normalizeConversationChannel('whatsapp')).toBe('whatsapp')
    expect(normalizeConversationChannel('facebook')).toBe('facebook')
    expect(normalizeConversationChannel('webchat')).toBeNull()
    expect(normalizeConversationChannel('tiktok')).toBeNull()
  })
})
