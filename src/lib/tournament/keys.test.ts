import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from 'jose'
import { currentSigningKey, publicJwks } from './keys'

async function privateJwk(kid: string): Promise<string> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true })
  return JSON.stringify({ ...(await exportJWK(privateKey)), kid })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('publicJwks', () => {
  it('is empty when no key is configured', () => {
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_CURRENT', '')
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_NEXT', '')

    expect(publicJwks()).toEqual({ keys: [] })
  })

  it('publishes the current key and, during a rotation, the next one', async () => {
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_CURRENT', await privateJwk('current'))
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_NEXT', await privateJwk('next'))

    expect(publicJwks().keys.map((key) => key.kid)).toEqual(['current', 'next'])
  })

  it('never publishes the private part of a key', async () => {
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_CURRENT', await privateJwk('current'))

    const [key] = publicJwks().keys
    expect(key).not.toHaveProperty('d')
    expect(key).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: 'current' })
  })

  it('refuses a key that is not JSON, without echoing it', () => {
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_CURRENT', 'secret-material')

    expect(() => publicJwks()).toThrow('TOURNAMENT_SIGNING_KEY_CURRENT is not valid JSON')
    expect(() => publicJwks()).not.toThrow(/secret-material/)
  })

  it('refuses a key without a kid or private part', async () => {
    const { kid: _kid, ...withoutKid } = JSON.parse(await privateJwk('x'))
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_CURRENT', JSON.stringify(withoutKid))
    expect(() => publicJwks()).toThrow('must be a P-256 private JWK with a kid')

    const { d: _d, ...publicOnly } = JSON.parse(await privateJwk('x'))
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_CURRENT', JSON.stringify(publicOnly))
    expect(() => publicJwks()).toThrow('must be a P-256 private JWK with a kid')
  })
})

describe('currentSigningKey', () => {
  it('is null when no key is configured', async () => {
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_CURRENT', '')

    expect(await currentSigningKey()).toBeNull()
  })

  // The format check that matters: what the token route signs, the engine can
  // verify with nothing but the published JWKS.
  it('signs tokens the published JWKS verifies', async () => {
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_CURRENT', await privateJwk('current'))
    const signing = await currentSigningKey()

    const token = await new SignJWT({ ctx: 'viadal:event:e1' })
      .setProtectedHeader({ alg: 'ES256', kid: signing!.kid })
      .setExpirationTime('15m')
      .sign(signing!.key)

    const { payload } = await jwtVerify(token, createLocalJWKSet(publicJwks()))
    expect(payload.ctx).toBe('viadal:event:e1')
  })
})
