import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  jwtVerify,
} from 'jose'
import { publicJwks } from './keys'
import { TENANT_PALETTES } from '@/lib/theme/tenant-colors'
import { TOURNAMENT_AUDIENCE, signTournamentToken } from './token'

const subject = {
  officialId: 'off-1',
  name: 'Anna Berg',
  eventId: 'evt-1',
  tenantId: 'ten-1',
  tier: 'premium',
  locale: 'sv',
  palette: TENANT_PALETTES.purple,
}

beforeEach(async () => {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true })
  vi.stubEnv(
    'TOURNAMENT_SIGNING_KEY_CURRENT',
    JSON.stringify({ ...(await exportJWK(privateKey)), kid: 'k1' })
  )
  vi.stubEnv('TOURNAMENT_TOKEN_ISSUER', 'https://app.viadalevent.se')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('signTournamentToken', () => {
  // What the engine does: verify against the JWKS, the issuer and the audience.
  it('carries the claims of ADR-0005 §6.1 and verifies against the published JWKS', async () => {
    const signed = await signTournamentToken(subject)

    const { payload } = await jwtVerify(signed!.token, createLocalJWKSet(publicJwks()), {
      issuer: 'https://app.viadalevent.se',
      audience: TOURNAMENT_AUDIENCE,
    })
    expect(payload).toMatchObject({
      sub: 'viadal:official:off-1',
      name: 'Anna Berg',
      ctx: 'viadal:event:evt-1',
      tenant: 'ten-1',
      tier: 'premium',
      locale: 'sv',
      palette: TENANT_PALETTES.purple,
    })
    expect(decodeProtectedHeader(signed!.token)).toMatchObject({ alg: 'ES256', kid: 'k1' })
  })

  it('lives fifteen minutes', async () => {
    const now = new Date('2026-11-17T12:00:00Z')

    const signed = await signTournamentToken(subject, now)

    const { payload } = await jwtVerify(signed!.token, createLocalJWKSet(publicJwks()), {
      currentDate: now,
    })
    expect(payload.exp! - payload.iat!).toBe(15 * 60)
    expect(signed!.expiresAt).toBe('2026-11-17T12:15:00.000Z')
  })

  it('is not accepted by an engine expecting another issuer', async () => {
    const signed = await signTournamentToken(subject)

    await expect(
      jwtVerify(signed!.token, createLocalJWKSet(publicJwks()), { issuer: 'https://dev.example' })
    ).rejects.toThrow()
  })

  it('returns null without an issuer or a signing key', async () => {
    vi.stubEnv('TOURNAMENT_TOKEN_ISSUER', '')
    expect(await signTournamentToken(subject)).toBeNull()

    vi.stubEnv('TOURNAMENT_TOKEN_ISSUER', 'https://app.viadalevent.se')
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_CURRENT', '')
    expect(await signTournamentToken(subject)).toBeNull()
  })
})
