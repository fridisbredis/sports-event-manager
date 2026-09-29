import { describe, it, expect } from 'vitest'
import {
  dayKey,
  distinctDays,
  dayWindow,
  resolveSelectedDay,
  mergeContiguousSlots,
  groupIntoWorkAreaRuns,
} from './day-window'

describe('dayKey', () => {
  it('takes the UTC calendar day from an ISO timestamp', () => {
    expect(dayKey('2026-08-12T09:00:00Z')).toBe('2026-08-12')
  })

  // The day must not shift with the runner's local zone. A naive
  // `new Date(ts).getDate()` would put this shift on the 11th for any
  // machine west of UTC and disagree with the day header rendered next to it.
  it('does not shift the day for a timestamp near midnight UTC', () => {
    expect(dayKey('2026-08-12T00:30:00.000Z')).toBe('2026-08-12')
    expect(dayKey('2026-08-12T23:45:00.000Z')).toBe('2026-08-12')
  })
})

describe('distinctDays', () => {
  it('deduplicates several shifts on one day into a single day', () => {
    expect(
      distinctDays(['2026-08-12T09:00:00Z', '2026-08-12T13:00:00Z', '2026-08-13T08:00:00Z'])
    ).toEqual(['2026-08-12', '2026-08-13'])
  })

  it('sorts ascending regardless of input order', () => {
    expect(distinctDays(['2026-08-13T08:00:00Z', '2026-08-12T09:00:00Z'])).toEqual([
      '2026-08-12',
      '2026-08-13',
    ])
  })

  it('returns nothing for no shifts', () => {
    expect(distinctDays([])).toEqual([])
  })
})

describe('dayWindow', () => {
  it('returns a half-open ISO range covering one UTC day', () => {
    expect(dayWindow('2026-08-12')).toEqual({
      start: '2026-08-12T00:00:00.000Z',
      end: '2026-08-13T00:00:00.000Z',
    })
  })

  // The end bound is the next day's start rather than 23:59:59, so a shift
  // beginning exactly at midnight belongs to one window only. Asserted the
  // way the query uses it: `.gte(start)` includes this day's midnight,
  // `.lt(end)` excludes the next day's.
  it('is half-open, so consecutive windows neither overlap nor gap', () => {
    const first = dayWindow('2026-08-12')
    const second = dayWindow('2026-08-13')

    expect(first.end).toBe(second.start)

    const thisMidnight = '2026-08-12T00:00:00.000Z'
    const nextMidnight = '2026-08-13T00:00:00.000Z'
    // In this day's window: gte start, lt end.
    expect(thisMidnight >= first.start && thisMidnight < first.end).toBe(true)
    // Not in this day's window — it belongs to the next one.
    expect(nextMidnight >= first.start && nextMidnight < first.end).toBe(false)
    expect(nextMidnight >= second.start && nextMidnight < second.end).toBe(true)
  })

  // A 23:59:59.999 shift must not fall past the end bound — the classic
  // off-by-one an `.lte('...T23:59:59Z')` end bound would introduce.
  it('includes the last instant of the day', () => {
    const { start, end } = dayWindow('2026-08-12')
    const lastInstant = '2026-08-12T23:59:59.999Z'
    expect(lastInstant >= start && lastInstant < end).toBe(true)
  })

  it('crosses a month boundary correctly', () => {
    expect(dayWindow('2026-08-31').end).toBe('2026-09-01T00:00:00.000Z')
  })

  it('crosses a year boundary correctly', () => {
    expect(dayWindow('2026-12-31').end).toBe('2027-01-01T00:00:00.000Z')
  })

  // Sweden is UTC+2 in August, so a naive local-time construction would put
  // the window start two hours off and silently drop the day's first shifts.
  it('anchors to UTC, not the local zone', () => {
    expect(dayWindow('2026-08-12').start.endsWith('T00:00:00.000Z')).toBe(true)
  })
})

describe('resolveSelectedDay', () => {
  const days = ['2026-08-12', '2026-08-13']

  it('honours a requested day the official actually works', () => {
    expect(resolveSelectedDay('2026-08-13', days, '2026-08-12')).toBe('2026-08-13')
  })

  it('defaults to today when today is one of the days', () => {
    expect(resolveSelectedDay(undefined, days, '2026-08-12')).toBe('2026-08-12')
  })

  it('falls back to the first day when today is not one of the days', () => {
    expect(resolveSelectedDay(undefined, days, '2026-07-01')).toBe('2026-08-12')
  })

  // Adversarial: a stale link or a hand-edited param must not select a day
  // with no shifts on it — that renders an empty schedule, which is exactly
  // the misleading-empty failure F-REL-10 removed from this page.
  it('rejects a requested day outside the official days', () => {
    expect(resolveSelectedDay('2027-01-01', days, '2026-08-12')).toBe('2026-08-12')
  })

  it('rejects a malformed requested day', () => {
    expect(resolveSelectedDay('not-a-date', days, '2026-08-12')).toBe('2026-08-12')
    expect(resolveSelectedDay('', days, '2026-07-01')).toBe('2026-08-12')
  })

  it('returns null when the official has no days at all', () => {
    expect(resolveSelectedDay(undefined, [], '2026-08-12')).toBeNull()
    expect(resolveSelectedDay('2026-08-12', [], '2026-08-12')).toBeNull()
  })
})

describe('mergeContiguousSlots', () => {
  const slot = (start: string, end: string) => ({ timeslot_start: start, timeslot_end: end })

  it('collapses a run of back-to-back hourly slots into one span', () => {
    expect(
      mergeContiguousSlots([
        slot('2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z'),
        slot('2026-08-12T12:00:00.000Z', '2026-08-12T13:00:00.000Z'),
        slot('2026-08-12T13:00:00.000Z', '2026-08-12T14:00:00.000Z'),
      ])
    ).toEqual([{ start: '2026-08-12T11:00:00.000Z', end: '2026-08-12T14:00:00.000Z' }])
  })

  // The whole point of merging: a gap must stay visible, or an official reads
  // a lunch break as time they are expected to be on station.
  it('starts a new span across a gap', () => {
    expect(
      mergeContiguousSlots([
        slot('2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z'),
        slot('2026-08-12T14:00:00.000Z', '2026-08-12T15:00:00.000Z'),
      ])
    ).toEqual([
      { start: '2026-08-12T11:00:00.000Z', end: '2026-08-12T12:00:00.000Z' },
      { start: '2026-08-12T14:00:00.000Z', end: '2026-08-12T15:00:00.000Z' },
    ])
  })

  // Adjacency is an instant comparison, not a string one: PostgREST can return
  // either shape, and `===` on the raw strings would split a contiguous run.
  it('joins slots whose boundary timestamps are spelled differently', () => {
    expect(
      mergeContiguousSlots([
        slot('2026-08-12T11:00:00+00:00', '2026-08-12T12:00:00+00:00'),
        slot('2026-08-12T12:00:00.000Z', '2026-08-12T13:00:00.000Z'),
      ])
    ).toEqual([{ start: '2026-08-12T11:00:00+00:00', end: '2026-08-12T13:00:00.000Z' }])
  })

  it('merges 30-minute slots the same way, without being told the granularity', () => {
    expect(
      mergeContiguousSlots([
        slot('2026-08-12T09:00:00.000Z', '2026-08-12T09:30:00.000Z'),
        slot('2026-08-12T09:30:00.000Z', '2026-08-12T10:00:00.000Z'),
      ])
    ).toEqual([{ start: '2026-08-12T09:00:00.000Z', end: '2026-08-12T10:00:00.000Z' }])
  })

  // A run that crosses midnight is one span, not two. The wireframe's
  // 22:00-00:00 row is exactly this case.
  it('merges across a midnight boundary', () => {
    expect(
      mergeContiguousSlots([
        slot('2026-08-12T22:00:00.000Z', '2026-08-12T23:00:00.000Z'),
        slot('2026-08-12T23:00:00.000Z', '2026-08-13T00:00:00.000Z'),
      ])
    ).toEqual([{ start: '2026-08-12T22:00:00.000Z', end: '2026-08-13T00:00:00.000Z' }])
  })

  it('does not shorten a span when a duplicate row repeats an earlier slot', () => {
    expect(
      mergeContiguousSlots([
        slot('2026-08-12T11:00:00.000Z', '2026-08-12T13:00:00.000Z'),
        slot('2026-08-12T13:00:00.000Z', '2026-08-12T12:00:00.000Z'),
      ])
    ).toEqual([{ start: '2026-08-12T11:00:00.000Z', end: '2026-08-12T13:00:00.000Z' }])
  })

  it('returns nothing for no slots', () => {
    expect(mergeContiguousSlots([])).toEqual([])
  })
})

describe('groupIntoWorkAreaRuns', () => {
  const slot = (start: string, end: string, ws: string | null) => ({
    timeslot_start: start,
    timeslot_end: end,
    ws,
  })
  const runs = (rows: ReturnType<typeof slot>[]) => groupIntoWorkAreaRuns(rows, (r) => r.ws)

  it('collapses consecutive slots at the same work area into one run', () => {
    const result = runs([
      slot('2026-08-12T08:00:00.000Z', '2026-08-12T09:00:00.000Z', 'water'),
      slot('2026-08-12T09:00:00.000Z', '2026-08-12T10:00:00.000Z', 'water'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].span).toEqual({
      start: '2026-08-12T08:00:00.000Z',
      end: '2026-08-12T10:00:00.000Z',
    })
    expect(result[0].slots).toHaveLength(2)
  })

  // The case `mergeContiguousSlots` alone would get wrong: two touching slots
  // at two different places must not fuse into one card claiming the official
  // was in both.
  it('starts a new run when the work area changes, even with no gap', () => {
    const result = runs([
      slot('2026-08-12T08:00:00.000Z', '2026-08-12T09:00:00.000Z', 'water'),
      slot('2026-08-12T09:00:00.000Z', '2026-08-12T10:00:00.000Z', 'finish'),
    ])
    expect(result.map((r) => r.workAreaId)).toEqual(['water', 'finish'])
    expect(result[0].span.end).toBe('2026-08-12T09:00:00.000Z')
    expect(result[1].span.start).toBe('2026-08-12T09:00:00.000Z')
  })

  it('starts a new run across a gap at the same work area', () => {
    const result = runs([
      slot('2026-08-12T08:00:00.000Z', '2026-08-12T09:00:00.000Z', 'water'),
      slot('2026-08-12T15:00:00.000Z', '2026-08-12T16:00:00.000Z', 'water'),
    ])
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.span.start)).toEqual([
      '2026-08-12T08:00:00.000Z',
      '2026-08-12T15:00:00.000Z',
    ])
  })

  // The screenshot's day: water 08-09, finish 11-14, water 15-16. The same
  // station appearing twice must stay two timeline entries.
  it('keeps the same work area as separate runs when it recurs later', () => {
    const result = runs([
      slot('2026-09-11T08:00:00.000Z', '2026-09-11T09:00:00.000Z', 'water'),
      slot('2026-09-11T11:00:00.000Z', '2026-09-11T12:00:00.000Z', 'finish'),
      slot('2026-09-11T12:00:00.000Z', '2026-09-11T13:00:00.000Z', 'finish'),
      slot('2026-09-11T13:00:00.000Z', '2026-09-11T14:00:00.000Z', 'finish'),
      slot('2026-09-11T15:00:00.000Z', '2026-09-11T16:00:00.000Z', 'water'),
    ])
    expect(
      result.map((r) => [r.workAreaId, r.span.start.slice(11, 16), r.span.end.slice(11, 16)])
    ).toEqual([
      ['water', '08:00', '09:00'],
      ['finish', '11:00', '14:00'],
      ['water', '15:00', '16:00'],
    ])
  })

  it('treats slots with no work area as their own runs', () => {
    const result = runs([
      slot('2026-08-12T08:00:00.000Z', '2026-08-12T09:00:00.000Z', null),
      slot('2026-08-12T09:00:00.000Z', '2026-08-12T10:00:00.000Z', null),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].workAreaId).toBeNull()
  })

  it('returns nothing for no slots', () => {
    expect(runs([])).toEqual([])
  })
})
