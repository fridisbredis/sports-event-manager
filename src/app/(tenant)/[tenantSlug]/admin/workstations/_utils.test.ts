import { describe, it, expect } from 'vitest'
import { Time } from '@internationalized/date'
import {
  hhmmToTime,
  timeToHHMM,
  initWindowsFromStored,
  getStageDays,
  expandWindows,
  matchStageHoursWindows,
} from './_utils'

describe('hhmmToTime', () => {
  it('parses an "HH:MM" string into a Time value', () => {
    const time = hhmmToTime('08:30')
    expect(time?.hour).toBe(8)
    expect(time?.minute).toBe(30)
  })

  it('returns undefined for an empty string', () => {
    expect(hhmmToTime('')).toBeUndefined()
  })
})

describe('timeToHHMM', () => {
  it('formats a Time value as a zero-padded "HH:MM" string', () => {
    expect(timeToHHMM(new Time(8, 5))).toBe('08:05')
  })

  it('returns an empty string for null', () => {
    expect(timeToHHMM(null)).toBe('')
  })
})

describe('initWindowsFromStored', () => {
  it('returns a single blank window when nothing is stored', () => {
    expect(initWindowsFromStored([], ['2026-08-10'])).toEqual([
      { start: '', end: '', limitToDay: null },
    ])
  })

  it('strips stored timestamps to HH:MM for a single-day stage', () => {
    const stored = [{ window_start: '2026-08-10T08:00', window_end: '2026-08-10T09:00' }]
    expect(initWindowsFromStored(stored, ['2026-08-10'])).toEqual([
      { start: '08:00', end: '09:00', limitToDay: null },
    ])
  })

  it('treats a window appearing on every stage day as recurring', () => {
    const stored = [
      { window_start: '2026-08-10T08:00', window_end: '2026-08-10T09:00' },
      { window_start: '2026-08-11T08:00', window_end: '2026-08-11T09:00' },
    ]
    expect(initWindowsFromStored(stored, ['2026-08-10', '2026-08-11'])).toEqual([
      { start: '08:00', end: '09:00', limitToDay: null },
    ])
  })

  it('treats a window appearing on only one of several stage days as limited to that day', () => {
    const stored = [{ window_start: '2026-08-10T08:00', window_end: '2026-08-10T09:00' }]
    expect(initWindowsFromStored(stored, ['2026-08-10', '2026-08-11'])).toEqual([
      { start: '08:00', end: '09:00', limitToDay: '2026-08-10' },
    ])
  })
})

describe('getStageDays', () => {
  it('returns the exact calendar days for a non-race stage (no buffer)', () => {
    const stage = {
      id: 's1',
      name: 'Stage',
      stage_type: 'non_race',
      start_time: '2026-08-10T08:00:00.000Z',
      end_time: '2026-08-10T10:00:00.000Z',
    }
    expect(getStageDays(stage)).toEqual(['2026-08-10'])
  })

  it('includes the day the ±1h race buffer spills into, matching the scheduling grid', () => {
    // A race stage that starts at 00:30 pulls the allocable range back to the
    // previous day (23:30) — the workstation form must see that extra day too,
    // or a window couldn't be set to match what the grid actually shows.
    const stage = {
      id: 's1',
      name: 'Stage',
      stage_type: 'race',
      start_time: '2026-08-10T00:30:00.000Z',
      end_time: '2026-08-10T01:00:00.000Z',
    }
    expect(getStageDays(stage)).toEqual(['2026-08-09', '2026-08-10'])
  })
})

describe('expandWindows', () => {
  it('covers a multi-day race stage edge to edge with no gap or overlap on the last day', () => {
    // Race stage Sun 2026-09-06 12:00 -> Sat 2026-09-12 12:00, matched to the
    // grid's own ±1h buffer (allocable range 09-06T11:00 -> 09-12T13:00):
    //  - day 1, limited to that day: 11:00 -> 00:00 (rolls to day 2)
    //  - recurring full-day window: 00:00 -> 00:00 (every day)
    //  - last day, limited to that day: 00:00 -> 13:00
    // The recurring window must not also land on the last day, or it would
    // roll past the stage's real end time and collide with the last-day window.
    const stageDays = [
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ]
    const windows = [
      { start: '11:00', end: '00:00', limitToDay: stageDays[0] },
      { start: '00:00', end: '00:00', limitToDay: null },
      { start: '00:00', end: '13:00', limitToDay: stageDays[stageDays.length - 1] },
    ]

    const result = expandWindows(windows, stageDays, '2026-09-06T11:00:00.000Z')
    const sorted = [...result].sort((a, b) => a.window_start.localeCompare(b.window_start))

    expect(sorted).toEqual([
      { window_start: '2026-09-06T11:00', window_end: '2026-09-07T00:00' },
      { window_start: '2026-09-07T00:00', window_end: '2026-09-08T00:00' },
      { window_start: '2026-09-08T00:00', window_end: '2026-09-09T00:00' },
      { window_start: '2026-09-09T00:00', window_end: '2026-09-10T00:00' },
      { window_start: '2026-09-10T00:00', window_end: '2026-09-11T00:00' },
      { window_start: '2026-09-11T00:00', window_end: '2026-09-12T00:00' },
      { window_start: '2026-09-12T00:00', window_end: '2026-09-12T13:00' },
    ])
  })

  it('drops the last stage day for a recurring overnight window (nothing to roll into beyond the stage)', () => {
    // Only one instance is generated, anchored on the first of the two stage
    // days — the window is never re-applied starting on the last day, since
    // rolling from there would go a full day past the stage's own end.
    const stageDays = ['2026-08-10', '2026-08-11']
    const windows = [{ start: '22:00', end: '06:00', limitToDay: null }]

    const result = expandWindows(windows, stageDays, '2026-08-10T08:00:00.000Z')

    expect(result).toEqual([{ window_start: '2026-08-10T22:00', window_end: '2026-08-11T06:00' }])
  })
})

describe('matchStageHoursWindows', () => {
  it('returns a single full-span window for a single-day stage', () => {
    const result = matchStageHoursWindows(['2026-08-10'], '08:00', '18:00')
    expect(result).toEqual([{ start: '08:00', end: '18:00', limitToDay: null }])
  })

  it('returns three windows spanning edge to edge for a multi-day stage', () => {
    const stageDays = ['2026-09-06', '2026-09-07', '2026-09-08']
    const result = matchStageHoursWindows(stageDays, '11:00', '13:00')

    expect(result).toEqual([
      { start: '11:00', end: '00:00', limitToDay: '2026-09-06' },
      { start: '00:00', end: '00:00', limitToDay: null },
      { start: '00:00', end: '13:00', limitToDay: '2026-09-08' },
    ])

    // The generated windows must expand to exactly the buffered range with no
    // gap or overlap — this is the whole point of the helper.
    const expanded = expandWindows(result, stageDays, `${stageDays[0]}T11:00:00.000Z`)
    const sorted = [...expanded].sort((a, b) => a.window_start.localeCompare(b.window_start))
    expect(sorted).toEqual([
      { window_start: '2026-09-06T11:00', window_end: '2026-09-07T00:00' },
      { window_start: '2026-09-07T00:00', window_end: '2026-09-08T00:00' },
      { window_start: '2026-09-08T00:00', window_end: '2026-09-08T13:00' },
    ])
  })

  it('returns an empty array when the stage has no resolvable hours', () => {
    expect(matchStageHoursWindows([], '08:00', '18:00')).toEqual([])
    expect(matchStageHoursWindows(['2026-08-10'], null, '18:00')).toEqual([])
    expect(matchStageHoursWindows(['2026-08-10'], '08:00', null)).toEqual([])
  })
})
