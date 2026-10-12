import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import {
  parseTikTokSignature,
  verifyTikTokSignature,
  extractTikTokEvents,
  isAuthorizationRemoved,
} from './tiktok'

const SECRET = 'test-secret'

function sign(body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${body}`, 'utf8')
    .digest('hex')
  return `t=${ts},s=${sig}`
}

describe('parseTikTokSignature', () => {
  it('separa timestamp y firma', () => {
    expect(parseTikTokSignature('t=1633174587,s=abc123')).toEqual({
      timestamp: '1633174587',
      signature: 'abc123',
    })
  })

  it('devuelve null si falta alguna parte', () => {
    expect(parseTikTokSignature(null)).toBeNull()
    expect(parseTikTokSignature('')).toBeNull()
    expect(parseTikTokSignature('t=123')).toBeNull()
    expect(parseTikTokSignature('s=abc')).toBeNull()
  })
})

describe('verifyTikTokSignature', () => {
  it('acepta una firma correcta', () => {
    const body = JSON.stringify({ event: 'message' })
    expect(verifyTikTokSignature(body, sign(body), SECRET)).toBe(true)
  })

  it('rechaza una firma con otro secreto', () => {
    const body = '{"a":1}'
    expect(verifyTikTokSignature(body, sign(body, 'otro'), SECRET)).toBe(false)
  })

  it('rechaza si el cuerpo fue alterado', () => {
    const body = '{"a":1}'
    const header = sign(body)
    expect(verifyTikTokSignature('{"a":2}', header, SECRET)).toBe(false)
  })

  it('rechaza una firma caducada (replay)', () => {
    const body = '{"a":1}'
    const old = Math.floor(Date.now() / 1000) - 3600
    expect(verifyTikTokSignature(body, sign(body, SECRET, old), SECRET)).toBe(
      false,
    )
  })

  it('rechaza sin secreto o sin cabecera', () => {
    expect(verifyTikTokSignature('{}', sign('{}'), '')).toBe(false)
    expect(verifyTikTokSignature('{}', null, SECRET)).toBe(false)
  })
})

describe('extractTikTokEvents', () => {
  it('extrae un mensaje del sobre estándar (content como string JSON)', () => {
    const payload = {
      client_key: 'key',
      event: 'im.message.receive',
      create_time: 1640995200,
      user_openid: 'open-123',
      content: JSON.stringify({ text: 'Hola', message_id: 'msg_1' }),
    }
    const [ev] = extractTikTokEvents(payload)
    expect(ev.userOpenId).toBe('open-123')
    expect(ev.message).toMatchObject({
      senderId: 'open-123',
      messageId: 'msg_1',
      text: 'Hola',
    })
    expect(ev.message?.timestamp).toBe(1640995200000)
  })

  it('extrae un mensaje con content como objeto', () => {
    const payload = {
      event: 'message',
      user_openid: 'u1',
      content: { message: { text: 'hey', message_id: 'm2' } },
    }
    const [ev] = extractTikTokEvents(payload)
    expect(ev.message?.text).toBe('hey')
    expect(ev.message?.messageId).toBe('m2')
  })

  it('tolera variantes tipo Business (sender/message)', () => {
    const payload = {
      event_type: 'message',
      sender: { user_id: 'biz-user' },
      message: { text: 'ping', message_id: 'm3' },
      timestamp: 1640995200,
    }
    const [ev] = extractTikTokEvents(payload)
    expect(ev.message?.senderId).toBe('biz-user')
    expect(ev.message?.text).toBe('ping')
  })

  it('acepta una lista de eventos', () => {
    const events = extractTikTokEvents([
      { event: 'authorization.removed', user_openid: 'u1' },
      { event: 'message', user_openid: 'u2', content: { text: 'hi' } },
    ])
    expect(events).toHaveLength(2)
    expect(isAuthorizationRemoved(events[0])).toBe(true)
    expect(events[1].message?.text).toBe('hi')
  })

  it('devuelve [] ante entradas sin eventos', () => {
    expect(extractTikTokEvents(null)).toEqual([])
    expect(extractTikTokEvents('nope')).toEqual([])
    expect(extractTikTokEvents({})).toEqual([])
  })
})

describe('isAuthorizationRemoved', () => {
  it('detecta la retirada de autorización', () => {
    expect(
      isAuthorizationRemoved({ event: 'authorization.removed', userOpenId: null, message: null }),
    ).toBe(true)
    expect(
      isAuthorizationRemoved({ event: 'message', userOpenId: null, message: null }),
    ).toBe(false)
  })
})
