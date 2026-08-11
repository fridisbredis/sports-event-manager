import { describe, it, expect } from 'vitest'
import { getAllocableRange, getAllocableDays } from './allocable-range'

describe('getAllocableRange', () => {
  it('returns the stage window unchanged for a non-race stage', () => {
    const range = getAllocableRange({
      stage_type: 'training',
      start_time: '2026-08-10T08:00:00.000Z',
      end_time: '2026-08-10T10:00:00.000Z',
    })

    expect(range).toEqual({ start: '2026-08-10T08:00:00.000Z', end: '2026-08-10T10:00:00.000Z' })
  })

  it('pads a race stage by one hour on each side', () => {
    const range = getAllocableRange({
      stage_type: 'race',
      start_time: '2026-08-10T09:00:00.000Z',
      end_time: '2026-08-10T09:00:00.000Z',
    })

    expect(range).toEqual({ start: '2026-08-10T08:00:00.000Z', end: '2026-08-10T10:00:00.000Z' })
  })

  it('returns null when the stage has no configured times', () => {
    expect(
      getAllocableRange({ stage_type: 'training', start_time: null, end_time: null })
    ).toBeNull()
  })
})

describe('getAllocableDays', () => {
  it('lists every calendar day the allocable range touches', () => {
    const days = getAllocableDays({
      stage_type: 'training',
      start_time: '2026-08-10T22:00:00.000Z',
      end_time: '2026-08-11T02:00:00.000Z',
    })

    expect(days).toEqual(['2026-08-10', '2026-08-11'])
  })

  it('returns an empty list when the stage has no configured times', () => {
    expect(getAllocableDays({ stage_type: 'training', start_time: null, end_time: null })).toEqual(
      []
    )
  })
})
