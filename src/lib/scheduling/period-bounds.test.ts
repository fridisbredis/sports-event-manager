import { describe, it, expect } from 'vitest'
import { toPeriodBounds, getEventDateRange } from './period-bounds'

// Dates are derived from today rather than written as literals — the seed is
// relative and a hard-coded date here ages out overnight.
const TODAY = new Date()
TODAY.setUTCHours(0, 0, 0, 0)

function dayOffset(days: number): string {
  const d = new Date(TODAY.getTime())
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('toPeriodBounds', () => {
  it('assembles an explicit time range as wall-clock UTC', () => {
    const day = dayOffset(1)
    const { startsAt, endsAt } = toPeriodBounds({
      startDate: day,
      endDate: day,
      startTime: '09:00',
      endTime: '17:00',
    })

    // 09:00 means the slot labelled 09:00 on the grid, which renders in UTC —
    // not 09:00 in whatever zone the browser happens to be in.
    expect(startsAt).toBe(`${day}T09:00:00.000Z`)
    expect(endsAt).toBe(`${day}T17:00:00.000Z`)
  })

  it('treats a whole single day as midnight to the next midnight', () => {
    const day = dayOffset(2)
    const { startsAt, endsAt } = toPeriodBounds({ startDate: day, endDate: day })

    expect(startsAt).toBe(`${day}T00:00:00.000Z`)
    expect(endsAt).toBe(`${dayOffset(3)}T00:00:00.000Z`)
  })

  it('treats the end date as inclusive for a whole-day range', () => {
    // "Saturday to Sunday" means both days in full. The exclusive upper bound
    // is therefore the start of Monday — getting this wrong silently drops the
    // last day of every multi-day absence.
    const { startsAt, endsAt } = toPeriodBounds({
      startDate: dayOffset(1),
      endDate: dayOffset(2),
    })

    expect(startsAt).toBe(`${dayOffset(1)}T00:00:00.000Z`)
    expect(endsAt).toBe(`${dayOffset(3)}T00:00:00.000Z`)
  })

  it('spans midnight when a timed range crosses days', () => {
    const { startsAt, endsAt } = toPeriodBounds({
      startDate: dayOffset(1),
      endDate: dayOffset(2),
      startTime: '22:00',
      endTime: '06:00',
    })

    expect(startsAt).toBe(`${dayOffset(1)}T22:00:00.000Z`)
    expect(endsAt).toBe(`${dayOffset(2)}T06:00:00.000Z`)
    expect(new Date(endsAt).getTime()).toBeGreaterThan(new Date(startsAt).getTime())
  })

  it('crosses a month boundary without drifting', () => {
    // setUTCDate(+1) past the end of a month is the arithmetic most likely to
    // be wrong; Date handles it, and this pins that it stays handled.
    const endOfMonth = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + 1, 0))
    const lastDay = endOfMonth.toISOString().slice(0, 10)
    const firstOfNext = new Date(endOfMonth.getTime())
    firstOfNext.setUTCDate(firstOfNext.getUTCDate() + 1)

    const { endsAt } = toPeriodBounds({ startDate: lastDay, endDate: lastDay })

    expect(endsAt).toBe(`${firstOfNext.toISOString().slice(0, 10)}T00:00:00.000Z`)
  })

  it('produces an end at or before the start when times are reversed', () => {
    // The action rejects this and the DB CHECK refuses it; this pins that the
    // helper itself does not quietly reorder the pair and hide the mistake.
    const day = dayOffset(1)
    const { startsAt, endsAt } = toPeriodBounds({
      startDate: day,
      endDate: day,
      startTime: '17:00',
      endTime: '09:00',
    })

    expect(new Date(endsAt).getTime()).toBeLessThan(new Date(startsAt).getTime())
  })
})

describe('getEventDateRange', () => {
  it('spans the earliest and latest day across stages', () => {
    const range = getEventDateRange([
      {
        stage_date: null,
        start_time: `${dayOffset(2)}T08:00:00Z`,
        end_time: `${dayOffset(2)}T17:00:00Z`,
      },
      {
        stage_date: null,
        start_time: `${dayOffset(1)}T08:00:00Z`,
        end_time: `${dayOffset(1)}T17:00:00Z`,
      },
      {
        stage_date: null,
        start_time: `${dayOffset(4)}T08:00:00Z`,
        end_time: `${dayOffset(4)}T17:00:00Z`,
      },
    ])

    expect(range).toEqual({ min: dayOffset(1), max: dayOffset(4) })
  })

  it('reads a stage that carries only a bare stage_date', () => {
    // An admin may date a stage before timing it. Ignoring these would
    // silently narrow the range and grey out real event days.
    const range = getEventDateRange([
      { stage_date: dayOffset(3), start_time: null, end_time: null },
      {
        stage_date: null,
        start_time: `${dayOffset(1)}T08:00:00Z`,
        end_time: `${dayOffset(1)}T17:00:00Z`,
      },
    ])

    expect(range).toEqual({ min: dayOffset(1), max: dayOffset(3) })
  })

  it('returns null when no stage carries any date', () => {
    // The caller must read null as "do not constrain" — an unbounded picker
    // beats one that rejects every date.
    expect(getEventDateRange([{ stage_date: null, start_time: null, end_time: null }])).toBeNull()
    expect(getEventDateRange([])).toBeNull()
  })

  it('takes the day in UTC, not the viewer’s zone', () => {
    // A 23:00Z stage belongs to that UTC day. Deriving via local time would
    // push it to the next day for a viewer east of UTC.
    const range = getEventDateRange([
      {
        stage_date: null,
        start_time: `${dayOffset(1)}T23:00:00Z`,
        end_time: `${dayOffset(2)}T02:00:00Z`,
      },
    ])

    expect(range).toEqual({ min: dayOffset(1), max: dayOffset(2) })
  })

  it('handles a single-day event', () => {
    const day = dayOffset(1)
    const range = getEventDateRange([
      { stage_date: null, start_time: `${day}T08:00:00Z`, end_time: `${day}T17:00:00Z` },
    ])

    expect(range).toEqual({ min: day, max: day })
  })
})
