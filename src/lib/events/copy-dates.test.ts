import { describe, it, expect } from 'vitest'
import {
  addDays,
  changeStageDate,
  daysBetween,
  firstDatedStageId,
  nextEditionName,
  placeStages,
  stageDate,
} from './copy-dates'

// Stages listed out of date order on purpose: position and date need not
// agree (a briefing can be listed after the race it precedes).
const STAGES = [
  { id: 'day2', start_time: '2026-06-02T07:00:00+00:00' },
  { id: 'night', start_time: '2026-06-01T20:00:00+00:00' },
  { id: 'briefing', start_time: null },
  { id: 'day4', start_time: '2026-06-04T07:00:00+00:00' },
]

describe('date helpers', () => {
  it('reads the wall-clock UTC date of a stage', () => {
    expect(stageDate('2026-06-01T23:30:00+00:00')).toBe('2026-06-01')
  })

  it('adds and counts whole days across a month end', () => {
    expect(addDays('2026-05-30', 3)).toBe('2026-06-02')
    expect(daysBetween('2026-05-30', '2026-06-02')).toBe(3)
  })
})

describe('placeStages', () => {
  it('moves every dated stage a year on, on the same weekday, keeping the spacing', () => {
    const placed = placeStages(STAGES)
    expect(placed).toEqual({ night: '2027-05-31', day2: '2027-06-01', day4: '2027-06-03' })
    // 2026-06-01 and 2027-05-31 are both Mondays.
    expect(new Date('2026-06-01').getUTCDay()).toBe(new Date('2027-05-31').getUTCDay())
  })

  it('leaves undated stages out', () => {
    expect(placeStages(STAGES)).not.toHaveProperty('briefing')
    expect(placeStages([{ id: 'x', start_time: null }])).toEqual({})
  })

  it('places from a given first date', () => {
    expect(placeStages(STAGES, '2027-06-10')).toEqual({
      night: '2027-06-10',
      day2: '2027-06-11',
      day4: '2027-06-13',
    })
  })
})

describe('changeStageDate', () => {
  const dates = placeStages(STAGES)

  it('finds the earliest-dated stage, whatever its position', () => {
    expect(firstDatedStageId(STAGES)).toBe('night')
  })

  it('moves the untouched stages along with the first one', () => {
    expect(changeStageDate(STAGES, dates, new Set(), 'night', '2027-06-14')).toEqual({
      night: '2027-06-14',
      day2: '2027-06-15',
      day4: '2027-06-17',
    })
  })

  it('keeps a stage the admin set by hand', () => {
    const touched = new Set(['day4'])
    const handSet = { ...dates, day4: '2027-07-01' }
    expect(changeStageDate(STAGES, handSet, touched, 'night', '2027-06-14')).toEqual({
      night: '2027-06-14',
      day2: '2027-06-15',
      day4: '2027-07-01',
    })
  })

  it('changes only that stage when it is not the first', () => {
    expect(changeStageDate(STAGES, dates, new Set(), 'day2', '2027-06-20')).toEqual({
      ...dates,
      day2: '2027-06-20',
    })
  })
})

describe('nextEditionName', () => {
  it.each([
    ['Viadal 2026', 'Viadal 2027'],
    ['Viadal 6D 2026', 'Viadal 6D 2027'],
    ['2026 Spring Run', '2027 Spring Run'],
    ['Seed Race', ''],
  ])('%s -> %s', (name, next) => {
    expect(nextEditionName(name)).toBe(next)
  })
})
