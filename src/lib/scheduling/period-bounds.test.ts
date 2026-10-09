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
    const [{ startsAt, endsAt }] = toPeriodBounds({
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
    const [{ startsAt, endsAt }] = toPeriodBounds({ startDate: day, endDate: day })

    expect(startsAt).toBe(`${day}T00:00:00.000Z`)
    expect(endsAt).toBe(`${dayOffset(3)}T00:00:00.000Z`)
  })

  it('treats the end date as inclusive for a whole-day range', () => {
    // "Saturday to Sunday" means both days in full. The exclusive upper bound
    // is therefore the start of Monday — getting this wrong silently drops the
    // last day of every multi-day absence.
    const [{ startsAt, endsAt }] = toPeriodBounds({
      startDate: dayOffset(1),
      endDate: dayOffset(2),
    })

    expect(startsAt).toBe(`${dayOffset(1)}T00:00:00.000Z`)
    expect(endsAt).toBe(`${dayOffset(3)}T00:00:00.000Z`)
  })

  // Previously this asserted that 22:00-06:00 over two days became ONE period
  // running overnight. It no longer does: a timed range repeats per day, and a
  // reversed pair is a mistake the action and the DB CHECK both reject rather
  // than something to silently reinterpret as an overnight absence.
  it('repeats a reversed time range per day rather than rolling it overnight', () => {
    const periods = toPeriodBounds({
      startDate: dayOffset(1),
      endDate: dayOffset(2),
      startTime: '22:00',
      endTime: '06:00',
    })

    expect(periods).toHaveLength(2)
    expect(periods[0].startsAt).toBe(`${dayOffset(1)}T22:00:00.000Z`)
    expect(periods[0].endsAt).toBe(`${dayOffset(1)}T06:00:00.000Z`)
    // Left invalid on purpose, so the caller rejects it instead of storing a
    // period nobody declared.
    expect(new Date(periods[0].endsAt).getTime()).toBeLessThan(
      new Date(periods[0].startsAt).getTime()
    )
  })

  // The bug this whole change exists for: "10:00-11:00, three days running"
  // used to store one 49-hour absence, which made the official unschedulable
  // through both nights and all of the middle day.
  it('repeats a timed range on each day of a multi-day span', () => {
    const periods = toPeriodBounds({
      startDate: dayOffset(1),
      endDate: dayOffset(3),
      startTime: '10:00',
      endTime: '11:00',
    })

    expect(periods).toHaveLength(3)
    expect(periods.map((p) => p.startsAt)).toEqual([
      `${dayOffset(1)}T10:00:00.000Z`,
      `${dayOffset(2)}T10:00:00.000Z`,
      `${dayOffset(3)}T10:00:00.000Z`,
    ])
    expect(periods.map((p) => p.endsAt)).toEqual([
      `${dayOffset(1)}T11:00:00.000Z`,
      `${dayOffset(2)}T11:00:00.000Z`,
      `${dayOffset(3)}T11:00:00.000Z`,
    ])
    // Nothing covers the night between day one and day two.
    expect(new Date(periods[0].endsAt).getTime()).toBeLessThan(
      new Date(periods[1].startsAt).getTime()
    )
  })

  it('keeps a whole-day multi-day range as one unbroken period', () => {
    // The other half of the rule: being away Mon-Wed really is one stretch,
    // nights included, so it must NOT become three rows.
    const periods = toPeriodBounds({ startDate: dayOffset(1), endDate: dayOffset(3) })

    expect(periods).toHaveLength(1)
    expect(periods[0].startsAt).toBe(`${dayOffset(1)}T00:00:00.000Z`)
    expect(periods[0].endsAt).toBe(`${dayOffset(4)}T00:00:00.000Z`)
  })

  it('crosses a month boundary when repeating a timed range', () => {
    // The per-day step is setUTCDate(+1) in a loop, so the month rollover is
    // worth pinning here too, not just in the whole-day branch.
    const endOfMonth = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + 1, 0))
    const lastDay = endOfMonth.toISOString().slice(0, 10)
    const firstOfNext = new Date(endOfMonth.getTime())
    firstOfNext.setUTCDate(firstOfNext.getUTCDate() + 1)
    const nextDay = firstOfNext.toISOString().slice(0, 10)

    const periods = toPeriodBounds({
      startDate: lastDay,
      endDate: nextDay,
      startTime: '10:00',
      endTime: '11:00',
    })

    expect(periods.map((p) => p.startsAt)).toEqual([
      `${lastDay}T10:00:00.000Z`,
      `${nextDay}T10:00:00.000Z`,
    ])
  })

  it('crosses a month boundary without drifting', () => {
    // setUTCDate(+1) past the end of a month is the arithmetic most likely to
    // be wrong; Date handles it, and this pins that it stays handled.
    const endOfMonth = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + 1, 0))
    const lastDay = endOfMonth.toISOString().slice(0, 10)
    const firstOfNext = new Date(endOfMonth.getTime())
    firstOfNext.setUTCDate(firstOfNext.getUTCDate() + 1)

    const [{ endsAt }] = toPeriodBounds({ startDate: lastDay, endDate: lastDay })

    expect(endsAt).toBe(`${firstOfNext.toISOString().slice(0, 10)}T00:00:00.000Z`)
  })

  it('produces an end at or before the start when times are reversed', () => {
    // The action rejects this and the DB CHECK refuses it; this pins that the
    // helper itself does not quietly reorder the pair and hide the mistake.
    const day = dayOffset(1)
    const [{ startsAt, endsAt }] = toPeriodBounds({
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
