import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair } from 'jose'
import { GET } from './route'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /.well-known/jwks.json', () => {
  it('publishes the public signing key with a short cache', async () => {
    const { privateKey } = await generateKeyPair('ES256', { extractable: true })
    vi.stubEnv(
      'TOURNAMENT_SIGNING_KEY_CURRENT',
      JSON.stringify({ ...(await exportJWK(privateKey)), kid: 'k1' })
    )

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0].kid).toBe('k1')
    expect(body.keys[0]).not.toHaveProperty('d')
  })

  it('answers with no keys when none is configured', async () => {
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_CURRENT', '')
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_NEXT', '')

    const res = await GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ keys: [] })
  })

  it('fails with 500 rather than publish a partial set when a key is malformed', async () => {
    vi.stubEnv('TOURNAMENT_SIGNING_KEY_CURRENT', 'not json')

    const res = await GET()

    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('not json')
  })
})
