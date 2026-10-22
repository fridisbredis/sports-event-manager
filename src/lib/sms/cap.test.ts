import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readSmsCapStatus, isSmsBlockedByCap } from './cap'

vi.mock('@/lib/db/query-error', () => ({ logQueryError: vi.fn() }))

/**
 * A Supabase client stub narrowed to the one query cap.ts makes:
 *   .from('sms_usage').select(...).eq(...).gte(...)
 * The chain resolves to whatever `result` holds.
 */
function serviceStub(result: { data?: unknown[]; error?: unknown }) {
  const gte = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  const eq = vi.fn(() => ({ gte }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, from, select, eq, gte }
}

const row = (segments: number, status = 'sent') => ({ segments, status })

beforeEach(() => {
  // A known rate, so the SEK assertions below are about the cap logic rather
  // than about whatever the placeholder happens to be.
  vi.stubEnv('SMS_SEK_PER_SEGMENT', '1')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('readSmsCapStatus', () => {
  it('reports spend against the tier cap', async () => {
    const { client } = serviceStub({ data: [row(10), row(5)] })

    const status = await readSmsCapStatus({
      service: client,
      tenantId: 't1',
      tier: 'standard',
      op: 'test',
    })

    expect(status).toEqual({
      spentSek: 15,
      capSek: 100,
      exceeded: false,
      fraction: 0.15,
      usingFallbackRate: false,
    })
  })

  it('uses the tier to pick the cap', async () => {
    const { client } = serviceStub({ data: [] })

    const professional = await readSmsCapStatus({
      service: client,
      tenantId: 't1',
      tier: 'professional',
      op: 'test',
    })

    expect(professional?.capSek).toBe(300)
  })

  it('treats an unrecognised tier as the lowest cap, not as uncapped', async () => {
    const { client } = serviceStub({ data: [] })

    const status = await readSmsCapStatus({
      service: client,
      tenantId: 't1',
      tier: 'enterprise-typo',
      op: 'test',
    })

    expect(status?.capSek).toBe(100)
  })

  it('counts failed sends as costing nothing', async () => {
    // Twilio does not charge for a message it refused.
    const { client } = serviceStub({ data: [row(10), row(90, 'failed')] })

    const status = await readSmsCapStatus({
      service: client,
      tenantId: 't1',
      tier: 'standard',
      op: 'test',
    })

    expect(status?.spentSek).toBe(10)
    expect(status?.exceeded).toBe(false)
  })

  it('is exceeded exactly at the cap, not only past it', async () => {
    const { client } = serviceStub({ data: [row(100)] })

    const status = await readSmsCapStatus({
      service: client,
      tenantId: 't1',
      tier: 'standard',
      op: 'test',
    })

    expect(status?.spentSek).toBe(100)
    expect(status?.exceeded).toBe(true)
  })

  it('clamps fraction to 1 when spend is over the cap', async () => {
    const { client } = serviceStub({ data: [row(250)] })

    const status = await readSmsCapStatus({
      service: client,
      tenantId: 't1',
      tier: 'standard',
      op: 'test',
    })

    expect(status?.fraction).toBe(1)
  })

  it('flags when the figures rest on the placeholder rate', async () => {
    vi.stubEnv('SMS_SEK_PER_SEGMENT', '')
    const { client } = serviceStub({ data: [] })

    const status = await readSmsCapStatus({
      service: client,
      tenantId: 't1',
      tier: 'standard',
      op: 'test',
    })

    expect(status?.usingFallbackRate).toBe(true)
  })

  it('queries only this tenant, and only since the start of the month', async () => {
    const { client, eq, gte } = serviceStub({ data: [] })

    await readSmsCapStatus({ service: client, tenantId: 't1', tier: 'standard', op: 'test' })

    expect(eq).toHaveBeenCalledWith('tenant_id', 't1')
    const since = gte.mock.calls[0][1] as string
    expect(since).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/)
  })

  it('returns null when the client throws rather than resolving', async () => {
    // A misconfigured service client, or a network layer that rejects. This
    // function must never be the reason a send turns into a 500.
    const client = {
      from: () => {
        throw new TypeError('service.from is not a function')
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    const status = await readSmsCapStatus({
      service: client,
      tenantId: 't1',
      tier: 'standard',
      op: 'test',
    })

    expect(status).toBeNull()
  })

  it('returns null when usage cannot be read', async () => {
    const { client } = serviceStub({ error: { message: 'boom' } })

    const status = await readSmsCapStatus({
      service: client,
      tenantId: 't1',
      tier: 'standard',
      op: 'test',
    })

    expect(status).toBeNull()
  })
})

describe('isSmsBlockedByCap', () => {
  it('blocks when the cap is reached', async () => {
    const { client } = serviceStub({ data: [row(100)] })

    await expect(
      isSmsBlockedByCap({ service: client, tenantId: 't1', tier: 'standard', op: 'test' })
    ).resolves.toBe(true)
  })

  it('allows when under the cap', async () => {
    const { client } = serviceStub({ data: [row(1)] })

    await expect(
      isSmsBlockedByCap({ service: client, tenantId: 't1', tier: 'standard', op: 'test' })
    ).resolves.toBe(false)
  })

  it('FAILS OPEN: allows sending when usage cannot be read', async () => {
    // A tenant that cannot be measured must not go silent. An event where
    // nobody can reach the officials is worse than overshooting a provisional
    // cap by one batch.
    const { client } = serviceStub({ error: { message: 'db down' } })

    await expect(
      isSmsBlockedByCap({ service: client, tenantId: 't1', tier: 'standard', op: 'test' })
    ).resolves.toBe(false)
  })
})
