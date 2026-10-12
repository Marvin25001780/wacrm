import { describe, it, expect, beforeEach } from 'vitest'

import {
  buildTikTokAuthUrl,
  exchangeTikTokCode,
  fetchTikTokUser,
  resolveTikTokScopes,
  signTikTokState,
  verifyTikTokState,
  DEFAULT_TIKTOK_SCOPES,
} from './tiktok-oauth'

beforeEach(() => {
  process.env.TIKTOK_CLIENT_SECRET = 'test-secret'
  delete process.env.TIKTOK_SCOPES
})

describe('buildTikTokAuthUrl', () => {
  it('incluye client_key, scope, redirect_uri y state', () => {
    const url = new URL(
      buildTikTokAuthUrl({
        clientKey: 'KEY',
        redirectUri: 'https://x/cb',
        state: 'st',
        scopes: ['user.info.basic', 'message.list.read'],
      }),
    )
    expect(url.origin).toBe('https://www.tiktok.com')
    expect(url.pathname).toBe('/v2/auth/authorize/')
    expect(url.searchParams.get('client_key')).toBe('KEY')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('user.info.basic,message.list.read')
    expect(url.searchParams.get('redirect_uri')).toBe('https://x/cb')
    expect(url.searchParams.get('state')).toBe('st')
  })
})

describe('resolveTikTokScopes', () => {
  it('usa los scopes por defecto', () => {
    expect(resolveTikTokScopes()).toEqual(DEFAULT_TIKTOK_SCOPES)
  })

  it('respeta TIKTOK_SCOPES con comas y espacios', () => {
    process.env.TIKTOK_SCOPES = 'user.info.basic, message.list.send '
    expect(resolveTikTokScopes()).toEqual(['user.info.basic', 'message.list.send'])
  })
})

describe('tiktok oauth state', () => {
  it('firma y verifica el payload', () => {
    const token = signTikTokState({
      state: 'abc',
      accountId: 'acc',
      userId: 'usr',
      exp: Date.now() + 60000,
    })
    expect(verifyTikTokState(token)).toMatchObject({
      state: 'abc',
      accountId: 'acc',
      userId: 'usr',
    })
  })

  it('rechaza firma manipulada o basura', () => {
    const token = signTikTokState({
      state: 'abc',
      accountId: 'acc',
      userId: 'usr',
      exp: Date.now() + 60000,
    })
    expect(verifyTikTokState(token + 'x')).toBeNull()
    expect(verifyTikTokState('bogus')).toBeNull()
  })

  it('rechaza un estado caducado', () => {
    const token = signTikTokState({
      state: 'abc',
      accountId: 'acc',
      userId: 'usr',
      exp: Date.now() - 1000,
    })
    expect(verifyTikTokState(token)).toBeNull()
  })
})

describe('exchangeTikTokCode', () => {
  it('devuelve el token cuando TikTok responde bien', async () => {
    const original = global.fetch
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: 'AT',
          refresh_token: 'RT',
          open_id: 'OPEN',
          scope: 'user.info.basic',
          expires_in: 86400,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch
    try {
      const res = await exchangeTikTokCode({
        clientKey: 'KEY',
        clientSecret: 'SEC',
        code: 'CODE',
        redirectUri: 'https://x/cb',
      })
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.data).toMatchObject({
        accessToken: 'AT',
        refreshToken: 'RT',
        openId: 'OPEN',
      })
    } finally {
      global.fetch = original
    }
  })

  it('propaga el error de TikTok', async () => {
    const original = global.fetch
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'code expirado' }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch
    try {
      const res = await exchangeTikTokCode({
        clientKey: 'KEY',
        clientSecret: 'SEC',
        code: 'CODE',
        redirectUri: 'https://x/cb',
      })
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.error).toContain('invalid_grant')
    } finally {
      global.fetch = original
    }
  })
})

describe('fetchTikTokUser', () => {
  it('extrae el usuario de la respuesta', async () => {
    const original = global.fetch
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            user: { open_id: 'O', display_name: 'Ana', username: 'ana', avatar_url: 'u' },
          },
          error: { code: 'ok' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch
    try {
      const res = await fetchTikTokUser('AT')
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.data).toMatchObject({
        openId: 'O',
        displayName: 'Ana',
        username: 'ana',
      })
    } finally {
      global.fetch = original
    }
  })
})
