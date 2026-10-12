import { describe, it, expect } from 'vitest'
import { formatStageDate, formatStageTime, stageTimeRangeParts } from './stage-range'

/**
 * What this guards: a stage that spans more than one day losing its end date.
 *
 * INFO-01 formatted the start's day and then both clock times, so the Viadal
 * race — 2 Aug 12:00 through 8 Aug 12:00 — rendered as
 * "Sun, 2 Aug · 12:00 – 12:00", which reads as a stage of zero length.
 */
describe('stageTimeRangeParts', () => {
  it('keeps the end date when the stage spans several days', () => {
    const parts = stageTimeRangeParts(
      '2026-08-02T12:00:00+00:00',
      '2026-08-08T12:00:00+00:00',
      'en'
    )
    expect(parts).toEqual({ from: 'Sun, 2 Aug 12:00', to: 'Sat, 8 Aug 12:00' })
  })

  it('omits the repeated date when the stage starts and ends the same day', () => {
    const parts = stageTimeRangeParts(
      '2026-06-12T07:00:00+00:00',
      '2026-06-12T22:00:00+00:00',
      'en'
    )
    expect(parts).toEqual({ from: 'Fri, 12 Jun 07:00', to: '22:00' })
  })

  it('still carries the end date when the stage ends just after midnight', () => {
    // One hour apart but two calendar days — the case a naive "is the gap
    // large?" test would get wrong.
    const parts = stageTimeRangeParts(
      '2026-08-02T23:30:00+00:00',
      '2026-08-03T00:30:00+00:00',
      'en'
    )
    expect(parts).toEqual({ from: 'Sun, 2 Aug 23:30', to: 'Mon, 3 Aug 00:30' })
  })

  it('returns a start-only range when the end has not been set', () => {
    expect(stageTimeRangeParts('2026-08-02T12:00:00+00:00', null, 'en')).toEqual({
      from: 'Sun, 2 Aug 12:00',
      to: null,
    })
  })

  it('returns null when the stage has no start time', () => {
    expect(stageTimeRangeParts(null, '2026-08-08T12:00:00+00:00', 'en')).toBeNull()
  })

  // The admin form hands over `datetime-local` values, which carry no zone.
  // Left to the Date constructor these are read as local time, which shifts
  // the day for any host west of Greenwich.
  it('reads a zoneless datetime-local string as UTC, like the stored value', () => {
    const parts = stageTimeRangeParts('2026-08-02T12:00', '2026-08-08T12:00', 'en')
    expect(parts).toEqual({ from: 'Sun, 2 Aug 12:00', to: 'Sat, 8 Aug 12:00' })
  })

  it('formats the same instant identically whichever input shape it arrives in', () => {
    expect(formatStageTime('2026-08-02T12:00', 'en')).toBe(
      formatStageTime('2026-08-02T12:00:00+00:00', 'en')
    )
    expect(formatStageDate('2026-08-02T12:00', 'en')).toBe(
      formatStageDate('2026-08-02T12:00:00+00:00', 'en')
    )
  })

  // Stage times are wall-clock UTC, so an offset-bearing timestamp is
  // normalised to UTC rather than shown as written.
  it('renders timestamps in UTC rather than the offset they carry', () => {
    expect(formatStageTime('2026-08-02T14:00:00+02:00', 'en')).toBe('12:00')
  })

  it('follows the UI language for weekday and month names', () => {
    const sv = stageTimeRangeParts('2026-08-02T12:00:00+00:00', '2026-08-08T12:00:00+00:00', 'sv')
    expect(sv?.from).toContain('aug')
    expect(sv?.from).not.toContain('Aug')
  })
})
