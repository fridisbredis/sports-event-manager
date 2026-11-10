import { describe, it, expect, vi } from 'vitest'

import { fetchClaimCounts, parseClaimFilter } from './claim-status'

vi.mock('@/lib/db/query-error', () => ({ logQueryError: vi.fn() }))

describe('parseClaimFilter', () => {
  it('accepts the known filters', () => {
    expect(parseClaimFilter('claimed')).toBe('claimed')
    expect(parseClaimFilter('unclaimed')).toBe('unclaimed')
  })

  it('reads a missing or unknown value as all', () => {
    expect(parseClaimFilter(undefined)).toBe('all')
    // Not yet a filter: Conflict arrives with N42's stored conflicts.
    expect(parseClaimFilter('conflict')).toBe('all')
  })
})

describe('fetchClaimCounts', () => {
  function stub(results: Array<{ count: number | null; error: unknown }>) {
    const calls: Array<{ is: unknown[][]; not: unknown[][] }> = []
    const from = vi.fn(() => {
      const call = { is: [] as unknown[][], not: [] as unknown[][] }
      calls.push(call)
      const result = results[calls.length - 1]
      const b: Record<string, unknown> = {}
      b.select = vi.fn(() => b)
      b.eq = vi.fn(() => b)
      b.is = vi.fn((...args: unknown[]) => (call.is.push(args), b))
      b.not = vi.fn((...args: unknown[]) => (call.not.push(args), b))
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
      return b
    })
    return { client: { from } as never, calls }
  }

  const ctx = { tenantId: 't', eventId: 'e', op: 'test' }

  it('counts everyone still on the start list, and the claimed among them', async () => {
    const { client, calls } = stub([
      { count: 42, error: null },
      { count: 28, error: null },
    ])

    expect(await fetchClaimCounts(client, ctx)).toEqual({ claimed: 28, total: 42 })
    // Withdrawn rows are out of BOTH numbers.
    expect(calls[0].is).toContainEqual(['withdrawn_at', null])
    expect(calls[1].is).toContainEqual(['withdrawn_at', null])
    expect(calls[1].not).toContainEqual(['user_id', 'is', null])
  })

  it('returns null rather than a made-up zero when a count fails', async () => {
    const { client } = stub([
      { count: 42, error: null },
      { count: null, error: { message: 'boom' } },
    ])

    expect(await fetchClaimCounts(client, ctx)).toBeNull()
  })
})
