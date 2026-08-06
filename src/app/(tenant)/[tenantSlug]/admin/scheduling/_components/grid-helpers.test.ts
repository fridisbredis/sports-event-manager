import { describe, it, expect } from 'vitest'
import { toLocalAssignments } from './grid-helpers'

describe('toLocalAssignments', () => {
  it('maps an inserted row to a local assignment, deriving timeslot_end from granularity', () => {
    const inserted = [
      {
        id: 'a1',
        official_id: 'o1',
        workstation_id: 'ws-1',
        timeslot_start: '2026-08-10T08:00:00.000Z',
        slot_index: 1,
      },
    ]

    const result = toLocalAssignments(inserted, 30)

    expect(result).toEqual([
      {
        id: 'a1',
        official_id: 'o1',
        workstation_id: 'ws-1',
        timeslot_start: '2026-08-10T08:00:00.000Z',
        timeslot_end: '2026-08-10T08:30:00.000Z',
        status: 'assigned',
        slot_index: 1,
      },
    ])
  })

  it('maps multiple inserted rows independently', () => {
    const inserted = [
      {
        id: 'a1',
        official_id: 'o1',
        workstation_id: 'ws-1',
        timeslot_start: '2026-08-10T08:00:00.000Z',
        slot_index: 1,
      },
      {
        id: 'a2',
        official_id: 'o2',
        workstation_id: 'ws-2',
        timeslot_start: '2026-08-10T09:00:00.000Z',
        slot_index: null,
      },
    ]

    const result = toLocalAssignments(inserted, 60)

    expect(result.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(result[1]).toEqual({
      id: 'a2',
      official_id: 'o2',
      workstation_id: 'ws-2',
      timeslot_start: '2026-08-10T09:00:00.000Z',
      timeslot_end: '2026-08-10T10:00:00.000Z',
      status: 'assigned',
      slot_index: null,
    })
  })

  it('returns an empty array for an empty input', () => {
    expect(toLocalAssignments([], 30)).toEqual([])
  })
})
