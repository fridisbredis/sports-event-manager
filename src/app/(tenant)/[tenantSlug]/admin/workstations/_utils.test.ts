import { describe, it, expect } from 'vitest'
import { Time } from '@internationalized/date'
import { hhmmToTime, timeToHHMM, initWindowsFromStored } from './_utils'

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
