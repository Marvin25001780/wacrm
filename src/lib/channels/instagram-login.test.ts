import { describe, expect, it } from 'vitest'

import { buildInstagramAuthUrl, resolveInstagramScopes } from './instagram-oauth'
import { extractInboundMessages } from './meta'

describe('extractInboundMessages', () => {
  it('lee el payload de Messenger (entry[].messaging)', () => {
    const events = extractInboundMessages({
      object: 'page',
      entry: [
        {
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'page-1' },
              timestamp: 1700000000000,
              message: { mid: 'm1', text: 'hola' },
            },
          ],
        },
      ],
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      senderId: 'psid-1',
      channel: 'facebook',
      text: 'hola',
      messageId: 'm1',
    })
  })

  it('lee el payload del login directo de Instagram (entry[].changes)', () => {
    const events = extractInboundMessages({
      object: 'instagram',
      entry: [
        {
          id: 'ig-1',
          time: 1700000000,
          changes: [
            {
              field: 'messages',
              value: {
                sender: { id: 'igsid-1' },
                recipient: { id: 'ig-1' },
                timestamp: 1700000000000,
                message: { mid: 'ig-m1', text: 'hola ig' },
              },
            },
          ],
        },
      ],
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      senderId: 'igsid-1',
      channel: 'instagram',
      text: 'hola ig',
      messageId: 'ig-m1',
    })
  })

  it('ignora ecos y eventos sin texto ni adjunto', () => {
    const events = extractInboundMessages({
      object: 'instagram',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                sender: { id: 'igsid-1' },
                message: { mid: 'x', text: 'eco', is_echo: true },
              },
            },
            { field: 'comments', value: { id: 'c1' } },
          ],
        },
      ],
    })

    expect(events).toHaveLength(0)
  })
})

describe('login directo de Instagram', () => {
  it('construye la URL de autorización con los scopes del producto', () => {
    const url = new URL(
      buildInstagramAuthUrl({
        appId: '123456',
        redirectUri: 'https://nexusbpo.space/api/channels/instagram/oauth/callback',
        state: 'abc',
        scopes: resolveInstagramScopes(),
      }),
    )

    expect(url.origin + url.pathname).toBe(
      'https://www.instagram.com/oauth/authorize',
    )
    expect(url.searchParams.get('client_id')).toBe('123456')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('abc')
    expect(url.searchParams.get('scope')).toContain('instagram_business_basic')
    expect(url.searchParams.get('scope')).toContain(
      'instagram_business_manage_messages',
    )
  })
})
