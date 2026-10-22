import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readSmsCapStatus, isSmsBlockedByCap, readAllTenantSmsUsage } from './cap'

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
      // Carried through from totalUsage so the detail page can show the
      // billable unit without a second query.
      segments: 15,
      failed: 0,
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

describe('readAllTenantSmsUsage', () => {
  function multiStub(result: { data?: unknown[]; error?: unknown }) {
    const gte = vi
      .fn()
      .mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
    const inFn = vi.fn(() => ({ gte }))
    const select = vi.fn(() => ({ in: inFn }))
    const from = vi.fn(() => ({ select }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { client: { from } as any, from, inFn, gte }
  }

  const TENANTS = [
    { id: 't1', name: 'Viadal 2026', tier: 'professional' },
    { id: 't2', name: 'Micke testar', tier: 'premium' },
    { id: 't3', name: 'Eddo testar', tier: 'standard' },
  ]

  it('reads every tenant in ONE query, not one per tenant', () => {
    // The point of this function. A loop issuing a query per tenant looks
    // fine at three and is quietly doing fifty later.
    const { client, from, inFn } = multiStub({ data: [] })

    return readAllTenantSmsUsage({ service: client, tenants: TENANTS, op: 'test' }).then(() => {
      expect(from).toHaveBeenCalledTimes(1)
      expect(inFn).toHaveBeenCalledWith('tenant_id', ['t1', 't2', 't3'])
    })
  })

  it('attributes rows to the right tenant and applies each ones own tier cap', async () => {
    const { client } = multiStub({
      data: [
        { tenant_id: 't1', segments: 10, status: 'sent' },
        { tenant_id: 't3', segments: 200, status: 'sent' },
        { tenant_id: 't1', segments: 5, status: 'sent' },
      ],
    })

    const rows = await readAllTenantSmsUsage({ service: client, tenants: TENANTS, op: 'test' })

    expect(rows).toHaveLength(3)
    const [viadal, micke, eddo] = rows!

    expect(viadal).toMatchObject({ tenantId: 't1', spentSek: 15, capSek: 300, exceeded: false })
    expect(micke).toMatchObject({ tenantId: 't2', spentSek: 0, capSek: 200, exceeded: false })
    expect(eddo).toMatchObject({ tenantId: 't3', spentSek: 200, capSek: 100, exceeded: true })
  })

  it('returns tenants with no usage at zero rather than omitting them', async () => {
    // A tenant missing from the list reads as a tenant that is missing, not
    // as one that has sent nothing.
    const { client } = multiStub({ data: [{ tenant_id: 't1', segments: 1, status: 'sent' }] })

    const rows = await readAllTenantSmsUsage({ service: client, tenants: TENANTS, op: 'test' })

    expect(rows!.map((r) => r.tenantId)).toEqual(['t1', 't2', 't3'])
    expect(rows!.filter((r) => r.spentSek === 0)).toHaveLength(2)
  })

  it('returns null when usage cannot be read, rather than a table of zeroes', async () => {
    // Zeroes would be indistinguishable from a genuinely quiet month.
    const { client } = multiStub({ error: { message: 'boom' } })

    await expect(
      readAllTenantSmsUsage({ service: client, tenants: TENANTS, op: 'test' })
    ).resolves.toBeNull()
  })

  it('does not query at all for an empty tenant list', async () => {
    const { client, from } = multiStub({ data: [] })

    await expect(
      readAllTenantSmsUsage({ service: client, tenants: [], op: 'test' })
    ).resolves.toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
})
