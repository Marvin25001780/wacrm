import { describe, it, expect, vi } from 'vitest'
import crypto from 'node:crypto'

import {
  extractInboundMessages,
  fetchMetaAccounts,
  metaAttachmentType,
  verifyMetaSignature,
} from './meta'

describe('extractInboundMessages', () => {
  it('normaliza un DM de Instagram', () => {
    const out = extractInboundMessages({
      object: 'instagram',
      entry: [
        {
          id: 'IG',
          messaging: [
            {
              sender: { id: 'S1' },
              recipient: { id: 'IG' },
              timestamp: 1700000000000,
              message: { mid: 'm1', text: 'hola' },
            },
          ],
        },
      ],
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      channel: 'instagram',
      senderId: 'S1',
      text: 'hola',
      messageId: 'm1',
    })
  })

  it('ignora ecos y recibos (sin message)', () => {
    const out = extractInboundMessages({
      object: 'page',
      entry: [
        {
          messaging: [
            { sender: { id: 'S' }, message: { is_echo: true, text: 'x' } },
            { sender: { id: 'S' }, delivery: { mids: ['x'] } },
          ],
        },
      ],
    })
    expect(out).toHaveLength(0)
  })

  it('mapea adjuntos de Facebook', () => {
    const out = extractInboundMessages({
      object: 'page',
      entry: [
        {
          messaging: [
            {
              sender: { id: 'S' },
              message: {
                mid: 'm2',
                attachments: [{ type: 'image', payload: { url: 'https://x/y.jpg' } }],
              },
            },
          ],
        },
      ],
    })
    expect(out[0]).toMatchObject({
      channel: 'facebook',
      attachmentUrl: 'https://x/y.jpg',
      attachmentType: 'image',
    })
  })
})

describe('verifyMetaSignature', () => {
  it('valida el HMAC SHA256', () => {
    const body = '{"a":1}'
    const secret = 's3cr3t'
    const sig =
      'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    expect(verifyMetaSignature(body, sig, secret)).toBe(true)
    expect(verifyMetaSignature(body, 'sha256=bad', secret)).toBe(false)
    expect(verifyMetaSignature(body, null, secret)).toBe(false)
    expect(verifyMetaSignature(body, sig, '')).toBe(false)
  })
})

describe('metaAttachmentType', () => {
  it('mapea los tipos de contenido a la Send API', () => {
    expect(metaAttachmentType('image')).toBe('image')
    expect(metaAttachmentType('video')).toBe('video')
    expect(metaAttachmentType('audio')).toBe('audio')
    expect(metaAttachmentType('document')).toBe('file')
    expect(metaAttachmentType('template')).toBeNull()
    expect(metaAttachmentType('text')).toBeNull()
  })
})

describe('fetchMetaAccounts', () => {
  it('parsea páginas con y sin cuenta de Instagram', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'P1',
                  name: 'Página 1',
                  access_token: 'T1',
                  instagram_business_account: { id: 'IG1', username: 'uno' },
                },
                { id: 'P2', name: 'Página 2', access_token: 'T2' },
                { id: 'P3', name: 'Sin token' },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )

    try {
      const res = await fetchMetaAccounts('user-token')
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.data).toHaveLength(2)
      expect(res.data[0]).toMatchObject({
        id: 'P1',
        name: 'Página 1',
        accessToken: 'T1',
        igUserId: 'IG1',
        igUsername: 'uno',
      })
      expect(res.data[1]).toMatchObject({ id: 'P2', igUserId: null })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
