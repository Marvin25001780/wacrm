import { describe, it, expect, beforeEach } from 'vitest'

import {
  buildMetaOAuthUrl,
  signMetaOAuthState,
  verifyMetaOAuthState,
  META_OAUTH_SCOPES,
} from './meta-oauth'

beforeEach(() => {
  process.env.META_APP_SECRET = 'test-secret'
})

describe('buildMetaOAuthUrl', () => {
  it('usa config_id cuando se indica', () => {
    const url = new URL(
      buildMetaOAuthUrl({
        appId: 'APP',
        configId: 'CFG',
        redirectUri: 'https://x/cb',
        state: 'st',
      }),
    )
    expect(url.origin).toBe('https://www.facebook.com')
    expect(url.pathname).toBe('/v25.0/dialog/oauth')
    expect(url.searchParams.get('client_id')).toBe('APP')
    expect(url.searchParams.get('config_id')).toBe('CFG')
    expect(url.searchParams.get('redirect_uri')).toBe('https://x/cb')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBeNull()
  })

  it('usa el scope clásico sin config_id', () => {
    const url = new URL(
      buildMetaOAuthUrl({
        appId: 'APP',
        redirectUri: 'https://x/cb',
        state: 'st',
      }),
    )
    expect(url.searchParams.get('config_id')).toBeNull()
    expect(url.searchParams.get('scope')).toBe(META_OAUTH_SCOPES.join(','))
  })
})

describe('meta oauth state', () => {
  it('firma y verifica el payload', () => {
    const token = signMetaOAuthState({
      state: 'abc',
      channel: 'instagram',
      accountId: 'acc',
      userId: 'usr',
      exp: Date.now() + 60000,
    })
    expect(verifyMetaOAuthState(token)).toMatchObject({
      state: 'abc',
      channel: 'instagram',
      accountId: 'acc',
      userId: 'usr',
    })
  })

  it('rechaza firma manipulada o basura', () => {
    const token = signMetaOAuthState({
      state: 'abc',
      channel: 'facebook',
      accountId: 'acc',
      userId: 'usr',
      exp: Date.now() + 60000,
    })
    expect(verifyMetaOAuthState(token + 'x')).toBeNull()
    expect(verifyMetaOAuthState('bogus')).toBeNull()
    expect(verifyMetaOAuthState('')).toBeNull()
  })

  it('rechaza un estado caducado', () => {
    const token = signMetaOAuthState({
      state: 'abc',
      channel: 'facebook',
      accountId: 'acc',
      userId: 'usr',
      exp: Date.now() - 1000,
    })
    expect(verifyMetaOAuthState(token)).toBeNull()
  })
})
