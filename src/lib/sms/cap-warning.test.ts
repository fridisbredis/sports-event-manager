import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { capWarningBody, isAtWarningThreshold, sendSmsCapWarnings } from './cap-warning'
import { logger } from '@/lib/logger'

vi.mock('@/lib/db/query-error', () => ({ logQueryError: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

type Result = { data?: unknown; error?: unknown }

interface Call {
  table: string
  /** The first method called on the builder: select, insert, update, delete. */
  op: string
  args: unknown[]
  /** Every filter method called after it, with its arguments. */
  filters: [string, unknown[]][]
}

/**
 * A Supabase client stub that answers by table and operation, and records
 * every call — so a test can both shape what the code reads and check what it
 * wrote.
 */
function fakeService(opts: {
  warned?: string[]
  warnedError?: unknown
  tenants?: { id: string; name: string; tier: string }[]
  /** sms_usage rows, as cap.ts reads them. */
  usage?: { tenant_id: string; segments: number; status: string }[]
  claimError?: { code?: string; message?: string } | null
  roles?: { user_id: string }[]
  phones?: Record<string, string | null>
}) {
  const calls: Call[] = []

  function resultFor(call: Call): Result {
    switch (`${call.table}.${call.op}`) {
      case 'sms_cap_warnings.select':
        return opts.warnedError
          ? { data: null, error: opts.warnedError }
          : { data: (opts.warned ?? []).map((tenant_id) => ({ tenant_id })), error: null }
      case 'sms_cap_warnings.insert':
        return { error: opts.claimError ?? null }
      case 'tenants.select':
        return { data: opts.tenants ?? [], error: null }
      case 'sms_usage.select':
        return { data: opts.usage ?? [], error: null }
      case 'user_roles.select':
        return { data: opts.roles ?? [], error: null }
      default:
        return { error: null }
    }
  }

  const from = vi.fn((table: string) => {
    let call: Call | null = null
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'insert', 'update', 'delete']) {
      builder[method] = vi.fn((...args: unknown[]) => {
        call = { table, op: method, args, filters: [] }
        calls.push(call)
        return builder
      })
    }
    for (const method of ['eq', 'in', 'gte', 'or', 'range']) {
      builder[method] = vi.fn((...args: unknown[]) => {
        call?.filters.push([method, args])
        return builder
      })
    }
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(resultFor(call!)).then(resolve, reject)
    return builder
  })

  const getUserById = vi.fn(async (userId: string) => ({
    data: { user: { phone: opts.phones?.[userId] ?? null } },
    error: null,
  }))

  return {
    service: { from, auth: { admin: { getUserById } } } as never,
    calls,
    getUserById,
  }
}

function fakeClient(create = vi.fn().mockResolvedValue({ numSegments: '1' })) {
  return { client: { messages: { create } } as never, create }
}

// 2026-10-15 — mid-month, so the month key is 2026-10-01.
const NOW = new Date('2026-10-15T12:00:00Z')

const STANDARD = { id: 't1', name: 'Viadal', tier: 'standard' } // cap 100
const usageRows = (tenantId: string, segments: number) =>
  Array.from({ length: segments }, () => ({ tenant_id: tenantId, segments: 1, status: 'sent' }))

beforeEach(() => {
  vi.clearAllMocks()
  // One SEK per segment, so usage rows read directly as kronor.
  vi.stubEnv('SMS_COST_PER_SEGMENT', '1')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isAtWarningThreshold', () => {
  it('is true from 90% of the cap', () => {
    expect(isAtWarningThreshold(89.99, 100)).toBe(false)
    expect(isAtWarningThreshold(90, 100)).toBe(true)
    expect(isAtWarningThreshold(150, 100)).toBe(true)
  })

  it('is never true without a cap', () => {
    expect(isAtWarningThreshold(0, 0)).toBe(false)
    expect(isAtWarningThreshold(50, 0)).toBe(false)
  })
})

describe('capWarningBody', () => {
  it('names the tenant, the share and the amounts', () => {
    expect(capWarningBody({ tenantName: 'Viadal', spentAmount: 272.4, capAmount: 300 })).toBe(
      'Sports Event Manager: Viadal has used 90% of its monthly SMS limit (272 of 300 SEK). ' +
        'At 100%, announcements and invites stop until next month.'
    )
  })

  it('stays within one GSM-7 segment for a typical tenant name', () => {
    const body = capWarningBody({ tenantName: 'Viadal', spentAmount: 95, capAmount: 100 })
    // ASCII only: anything else risks UCS-2 and a 70-character segment.
    expect(body).toMatch(/^[\x20-\x7e]*$/)
    expect(body.length).toBeLessThanOrEqual(160)
  })
})

describe('sendSmsCapWarnings', () => {
  it('texts every tenant admin and system admin once a tenant reaches 90%', async () => {
    const { service, calls } = fakeService({
      tenants: [STANDARD],
      usage: usageRows('t1', 90),
      roles: [{ user_id: 'tenant-admin' }, { user_id: 'sys-admin' }],
      phones: { 'tenant-admin': '46701111111', 'sys-admin': '46702222222' },
    })
    const { client, create } = fakeClient()

    const warned = await sendSmsCapWarnings({
      service,
      client,
      fromNumber: '+15550001111',
      now: NOW,
    })

    expect(warned).toBe(1)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ from: '+15550001111', to: '+46701111111' })
    )
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ to: '+46702222222' }))

    // Rule 3: claimed for this tenant and month before sending.
    const claim = calls.find((c) => c.table === 'sms_cap_warnings' && c.op === 'insert')
    expect(claim?.args[0]).toEqual({ tenant_id: 't1', month: '2026-10-01' })

    // Recipients are this tenant's admins plus every system admin.
    const roles = calls.find((c) => c.table === 'user_roles')
    expect(roles?.filters).toContainEqual([
      'or',
      ['role.eq.system_admin,and(role.eq.tenant_admin,tenant_id.eq.t1)'],
    ])

    // Counts recorded on the claim row for reconciliation.
    const record = calls.find((c) => c.table === 'sms_cap_warnings' && c.op === 'update')
    expect(record?.args[0]).toEqual({ sent_count: 2, failed_count: 0, segments: 2 })
  })

  it('does not warn a tenant below 90%', async () => {
    const { service, calls } = fakeService({
      tenants: [STANDARD],
      usage: usageRows('t1', 89),
    })
    const { client, create } = fakeClient()

    expect(await sendSmsCapWarnings({ service, client, fromNumber: '+1', now: NOW })).toBe(0)
    expect(create).not.toHaveBeenCalled()
    expect(calls.some((c) => c.op === 'insert')).toBe(false)
  })

  it('does not warn a tenant already warned this month, nor read its usage', async () => {
    const { service, calls } = fakeService({
      warned: ['t1'],
      tenants: [STANDARD],
      usage: usageRows('t1', 99),
    })
    const { client, create } = fakeClient()

    await sendSmsCapWarnings({ service, client, fromNumber: '+1', now: NOW })

    expect(create).not.toHaveBeenCalled()
    expect(calls.some((c) => c.table === 'sms_usage')).toBe(false)
    const warnedRead = calls.find((c) => c.table === 'sms_cap_warnings' && c.op === 'select')
    expect(warnedRead?.filters).toContainEqual(['eq', ['month', '2026-10-01']])
  })

  // Rule 4: the cap stops announcements and invites, never this.
  it('still warns a tenant already past its cap', async () => {
    const { service } = fakeService({
      tenants: [STANDARD],
      usage: usageRows('t1', 140),
      roles: [{ user_id: 'a' }],
      phones: { a: '46701111111' },
    })
    const { client, create } = fakeClient()

    await sendSmsCapWarnings({ service, client, fromNumber: '+1', now: NOW })

    expect(create).toHaveBeenCalledTimes(1)
  })

  // Rule 5: the warning is not tenant spend.
  it('never records the warning in sms_usage', async () => {
    const { service, calls } = fakeService({
      tenants: [STANDARD],
      usage: usageRows('t1', 95),
      roles: [{ user_id: 'a' }],
      phones: { a: '46701111111' },
    })

    await sendSmsCapWarnings({ service, client: fakeClient().client, fromNumber: '+1', now: NOW })

    expect(calls.filter((c) => c.table === 'sms_usage').map((c) => c.op)).toEqual(['select'])
  })

  // Rule 6: recipients come from user_roles + auth, never the officials roster.
  it('never reads officials, so sms_opt_out cannot exclude an admin', async () => {
    const { service, calls } = fakeService({
      tenants: [STANDARD],
      usage: usageRows('t1', 95),
      roles: [{ user_id: 'a' }],
      phones: { a: '46701111111' },
    })

    await sendSmsCapWarnings({ service, client: fakeClient().client, fromNumber: '+1', now: NOW })

    expect(calls.some((c) => c.table === 'officials')).toBe(false)
  })

  it('sends one SMS per person even when they hold several admin rows', async () => {
    const { service, getUserById } = fakeService({
      tenants: [STANDARD],
      usage: usageRows('t1', 95),
      roles: [{ user_id: 'a' }, { user_id: 'a' }, { user_id: 'b' }],
      phones: { a: '46701111111', b: '46702222222' },
    })
    const { client, create } = fakeClient()

    await sendSmsCapWarnings({ service, client, fromNumber: '+1', now: NOW })

    expect(getUserById).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('skips the send when another tick already claimed the tenant', async () => {
    const { service } = fakeService({
      tenants: [STANDARD],
      usage: usageRows('t1', 95),
      claimError: { code: '23505', message: 'duplicate key' },
      roles: [{ user_id: 'a' }],
      phones: { a: '46701111111' },
    })
    const { client, create } = fakeClient()

    expect(await sendSmsCapWarnings({ service, client, fromNumber: '+1', now: NOW })).toBe(0)
    expect(create).not.toHaveBeenCalled()
  })

  it('releases the claim when every send failed, so the next tick retries', async () => {
    const { service, calls } = fakeService({
      tenants: [STANDARD],
      usage: usageRows('t1', 95),
      roles: [{ user_id: 'a' }],
      phones: { a: '46701111111' },
    })
    const { client } = fakeClient(vi.fn().mockRejectedValue({ code: 20003 }))

    expect(await sendSmsCapWarnings({ service, client, fromNumber: '+1', now: NOW })).toBe(0)

    const release = calls.find((c) => c.table === 'sms_cap_warnings' && c.op === 'delete')
    expect(release?.filters).toEqual([
      ['eq', ['tenant_id', 't1']],
      ['eq', ['month', '2026-10-01']],
    ])
  })

  it('keeps the claim when some sends succeeded', async () => {
    const { service, calls } = fakeService({
      tenants: [STANDARD],
      usage: usageRows('t1', 95),
      roles: [{ user_id: 'a' }, { user_id: 'b' }],
      phones: { a: '46701111111', b: '46702222222' },
    })
    const create = vi
      .fn()
      .mockResolvedValueOnce({ numSegments: '1' })
      .mockRejectedValueOnce({ code: 21211 })

    await sendSmsCapWarnings({
      service,
      client: fakeClient(create).client,
      fromNumber: '+1',
      now: NOW,
    })

    expect(calls.some((c) => c.op === 'delete')).toBe(false)
    const record = calls.find((c) => c.table === 'sms_cap_warnings' && c.op === 'update')
    expect(record?.args[0]).toEqual({ sent_count: 1, failed_count: 1, segments: 1 })
  })

  it('does nothing when the warned list cannot be read', async () => {
    const { service, calls } = fakeService({
      warnedError: { message: 'boom' },
      tenants: [STANDARD],
      usage: usageRows('t1', 95),
    })
    const { client, create } = fakeClient()

    expect(await sendSmsCapWarnings({ service, client, fromNumber: '+1', now: NOW })).toBe(0)
    expect(create).not.toHaveBeenCalled()
    expect(calls.some((c) => c.table === 'tenants')).toBe(false)
  })

  it('never throws, so the worker tick survives a broken client', async () => {
    const service = {
      from: vi.fn(() => {
        throw new Error('client exploded')
      }),
    } as never

    await expect(
      sendSmsCapWarnings({ service, client: fakeClient().client, fromNumber: '+1', now: NOW })
    ).resolves.toBe(0)
    expect(logger.error).toHaveBeenCalled()
  })
})
