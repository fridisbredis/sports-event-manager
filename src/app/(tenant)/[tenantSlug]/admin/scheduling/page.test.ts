import { describe, it, expect, vi } from 'vitest'
import { fetchAssignmentsForDay } from './page'

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'gte', 'lt', 'order']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockSupabase(result: unknown) {
  const builder = chain(result)
  const from = vi.fn().mockReturnValue(builder)
  return { supabase: { from } as never, builder, from }
}

describe('fetchAssignmentsForDay', () => {
  it('scopes the query to [day 00:00 UTC, next day 00:00 UTC) and the given tenant', async () => {
    const { supabase, builder, from } = mockSupabase({ data: [] })

    await fetchAssignmentsForDay(supabase, 'tenant-1', '2026-08-02')

    expect(from).toHaveBeenCalledWith('assignments')
    expect(builder.eq).toHaveBeenCalledWith('tenant_id', 'tenant-1')
    expect(builder.gte).toHaveBeenCalledWith('timeslot_start', '2026-08-02T00:00:00.000Z')
    expect(builder.lt).toHaveBeenCalledWith('timeslot_start', '2026-08-03T00:00:00.000Z')
  })

  it('rolls over the month/year boundary correctly', async () => {
    const { supabase, builder } = mockSupabase({ data: [] })

    await fetchAssignmentsForDay(supabase, 'tenant-1', '2026-12-31')

    expect(builder.gte).toHaveBeenCalledWith('timeslot_start', '2026-12-31T00:00:00.000Z')
    expect(builder.lt).toHaveBeenCalledWith('timeslot_start', '2027-01-01T00:00:00.000Z')
  })

  it('returns the fetched rows', async () => {
    const rows = [
      {
        id: 'a1',
        official_id: 'o1',
        workstation_id: 'ws-1',
        timeslot_start: '2026-08-02T05:00:00.000Z',
        timeslot_end: '2026-08-02T05:30:00.000Z',
        status: 'assigned',
        slot_index: 1,
      },
    ]
    const { supabase } = mockSupabase({ data: rows })

    const result = await fetchAssignmentsForDay(supabase, 'tenant-1', '2026-08-02')

    expect(result).toEqual(rows)
  })

  it('returns an empty array when data is null', async () => {
    const { supabase } = mockSupabase({ data: null })

    expect(await fetchAssignmentsForDay(supabase, 'tenant-1', '2026-08-02')).toEqual([])
  })

  it('throws when the query errors', async () => {
    const { supabase } = mockSupabase({ data: null, error: new Error('boom') })

    await expect(fetchAssignmentsForDay(supabase, 'tenant-1', '2026-08-02')).rejects.toThrow('boom')
  })
})
