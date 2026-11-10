import { describe, it, expect, vi } from 'vitest'

import { claimStatusOf, fetchClaimCounts, parseClaimFilter } from './claim-status'

vi.mock('@/lib/db/query-error', () => ({ logQueryError: vi.fn() }))

describe('parseClaimFilter', () => {
  it('accepts the known filters', () => {
    expect(parseClaimFilter('claimed')).toBe('claimed')
    expect(parseClaimFilter('unclaimed')).toBe('unclaimed')
    expect(parseClaimFilter('conflict')).toBe('conflict')
  })

  it('reads a missing or unknown value as all', () => {
    expect(parseClaimFilter(undefined)).toBe('all')
    expect(parseClaimFilter('disputed')).toBe('all')
  })
})

describe('claimStatusOf (N42)', () => {
  it('is conflict only for a claimed row with someone waiting', () => {
    expect(claimStatusOf({ claimed: false, pendingClaims: 0 })).toBe('unclaimed')
    expect(claimStatusOf({ claimed: true, pendingClaims: 0 })).toBe('claimed')
    expect(claimStatusOf({ claimed: true, pendingClaims: 2 })).toBe('conflict')
    // Cannot happen (the trigger clears them on unlink), but never "conflict".
    expect(claimStatusOf({ claimed: false, pendingClaims: 1 })).toBe('unclaimed')
  })
})

describe('fetchClaimCounts', () => {
  function stub(results: Array<{ count: number | null; error: unknown }>) {
    const calls: Array<{ select: unknown[][]; is: unknown[][]; not: unknown[][] }> = []
    const from = vi.fn(() => {
      const call = { select: [] as unknown[][], is: [] as unknown[][], not: [] as unknown[][] }
      calls.push(call)
      const result = results[calls.length - 1]
      const b: Record<string, unknown> = {}
      b.select = vi.fn((...args: unknown[]) => (call.select.push(args), b))
      b.eq = vi.fn(() => b)
      b.is = vi.fn((...args: unknown[]) => (call.is.push(args), b))
      b.not = vi.fn((...args: unknown[]) => (call.not.push(args), b))
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
      return b
    })
    return { client: { from } as never, calls }
  }

  const ctx = { tenantId: 't', eventId: 'e', op: 'test' }

  it('counts everyone still on the start list, the claimed and the conflicts among them', async () => {
    const { client, calls } = stub([
      { count: 42, error: null },
      { count: 28, error: null },
      { count: 2, error: null },
    ])

    expect(await fetchClaimCounts(client, ctx)).toEqual({ claimed: 28, total: 42, conflicts: 2 })
    // Withdrawn rows are out of every number.
    for (const call of calls) expect(call.is).toContainEqual(['withdrawn_at', null])
    expect(calls[1].not).toContainEqual(['user_id', 'is', null])
    // Per record: an inner embed, so a row with three claimants counts once.
    expect(String(calls[2].select[0][0])).toContain('participant_claim_conflicts!inner')
  })

  it('returns null rather than a made-up zero when a count fails', async () => {
    const { client } = stub([
      { count: 42, error: null },
      { count: 28, error: null },
      { count: null, error: { message: 'boom' } },
    ])

    expect(await fetchClaimCounts(client, ctx)).toBeNull()
  })
})
